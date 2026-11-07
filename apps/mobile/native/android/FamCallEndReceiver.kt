package com.silvergridtech.famcall.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.*
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Delivers a system decline even when the React runtime was never started. */
class FamCallEndReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "expo.modules.callkittelecom.ACTION_CALL_EVENT" ||
            intent.getStringExtra("eventName") != "onCallEnded") return
        val payload = runCatching { JSONObject(intent.getStringExtra("payload") ?: "") }.getOrNull() ?: return
        val id = payload.optJSONObject("session")?.optJSONObject("incomingCallEvent")?.optString("serverCallId") ?: return
        if (runCatching { UUID.fromString(id) }.isFailure) return
        FirebaseApp.initializeApp(context)
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val work = OneTimeWorkRequestBuilder<FamCallEndWorker>()
            .setInputData(workDataOf("callId" to id, "uid" to uid, "queuedAt" to System.currentTimeMillis()))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("famcall-end-$id", ExistingWorkPolicy.KEEP, work)
    }
}

class FamCallEndWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val id = inputData.getString("callId") ?: return Result.failure()
        if (System.currentTimeMillis() - inputData.getLong("queuedAt", 0) > 4 * 60 * 60 * 1000) return Result.success()
        val app = FirebaseApp.getInstance()
        val auth = FirebaseAuth.getInstance(app)
        if (auth.currentUser?.uid != inputData.getString("uid")) return Result.success()
        val functions = FirebaseFunctions.getInstance(app, "us-east1")
        if (applicationContext.packageName.endsWith(".e2e") && app.options.projectId == "demo-famcall") {
            runCatching { auth.useEmulator("10.0.2.2", 9099) }
            functions.useEmulator("10.0.2.2", 5001)
        } else {
            FirebaseAppCheck.getInstance(app).installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
        }
        return try {
            val callable = functions.getHttpsCallable("updateCall")
            callable.setTimeout(20, TimeUnit.SECONDS)
            Tasks.await(callable.call(mapOf("callId" to id, "action" to "end")), 25, TimeUnit.SECONDS)
            Result.success()
        } catch (error: Exception) {
            val cause = error.cause ?: error
            if (cause is FirebaseFunctionsException && cause.code in listOf(
                    FirebaseFunctionsException.Code.NOT_FOUND, FirebaseFunctionsException.Code.PERMISSION_DENIED)) Result.success()
            else Result.retry()
        }
    }
}
