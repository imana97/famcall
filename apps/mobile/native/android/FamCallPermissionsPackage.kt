package com.silvergridtech.famcall.permissions

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/** Read-only status and a user-invoked Settings link. This never grants access. */
class FamCallPermissionsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  override fun getName() = "FamCallPermissions"

  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      promise.resolve(Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
    } catch (error: Exception) {
      promise.reject("call_settings_unavailable", "Could not read call settings", error)
    }
  }

  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null || activity.isFinishing) {
      promise.reject("call_settings_background", "Open FamCall to change call settings")
      return
    }
    activity.runOnUiThread {
      try {
        val action = if (Build.VERSION.SDK_INT >= 34)
          Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        activity.startActivity(Intent(action, Uri.parse("package:${context.packageName}")))
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("call_settings_unavailable", "Could not open call settings", error)
      }
    }
  }
}

class FamCallPermissionsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(FamCallPermissionsModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
