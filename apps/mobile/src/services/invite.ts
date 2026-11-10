import * as SMS from "expo-sms";
import { Share } from "react-native";
import { normalizePhone } from "@famcall/core";
import { t } from "../i18n";

export const famcallWebsite = "https://famcall.web.app";
/** Only prepares an OS composer. FamCall never sends a text itself. */
export async function inviteToFamCall(phone: string): Promise<void> {
  const recipient = normalizePhone(phone);
  // The OS composer handles text direction; keep its URL free of UI bidi markers.
  const message = t("inviteMessage", { url: famcallWebsite }).replace(/[\u2068\u2069]/g, "");
  if (await SMS.isAvailableAsync()) {
    await SMS.sendSMSAsync([recipient], message);
    return;
  }
  await Share.share({ message });
}
