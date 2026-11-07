const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const tag = 'famcall-firebase-phone-auth';
const callbacks = `  // Forward standard APNs callbacks explicitly. PushKit's VoIP
  // token is separate and cannot verify a Firebase phone sign-in.
  public override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    Auth.auth().setAPNSToken(deviceToken, type: .unknown)
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  public override func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if Auth.auth().canHandleNotification(userInfo) {
      completionHandler(.noData)
      return
    }
    super.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler)
  }`;

module.exports = config => {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIBackgroundModes = [...new Set([
      ...(mod.modResults.UIBackgroundModes ?? []),
      'fetch',
      'remote-notification',
    ])];
    return mod;
  });
  return withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('Firebase phone verification requires the Swift AppDelegate.');
    }
    let contents = mod.modResults.contents;
    if (!contents.includes(`@generated begin ${tag}`) &&
        /didRegisterForRemoteNotificationsWithDeviceToken|didReceiveRemoteNotification/.test(contents)) {
      throw new Error('Review existing APNs callbacks before adding Firebase phone verification.');
    }
    if (!/^import FirebaseAuth\s*$/m.test(contents)) contents = 'import FirebaseAuth\n' + contents;
    contents = mergeContents({
      tag, src: contents, newSrc: callbacks,
      anchor: /\bclass AppDelegate[^\n]*\{/, offset: 1, comment: '//',
    }).contents;
    mod.modResults.contents = contents;
    return mod;
  });
};
