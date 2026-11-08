FamCall in-app languages

English and Persian plus ten additional widely spoken languages: Simplified
Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian
and Urdu. All layouts, navigation, controls and phone-number fields stay LTR.
Arabic-script text still uses normal joined letter shapes; inserted names and
numbers are isolated so that their characters are not reordered.

New installs follow the phone's ordered language preferences. An explicit choice
in Settings survives restarts and overrides automatic selection. Phone language
returns to automatic selection. Unsupported preferences fall back to English.
Chinese regional tags currently use the Simplified Chinese catalog.

To add or revise a language, keep the complete key set in en.ts, preserve every
{name}, {phone}, {seconds}, {url} and {version} placeholder, and review the meaning
of consent, permissions and account-deletion text. Add its native name to
languages.ts, its catalog to index.ts, and localized iOS permission explanations
to apps/mobile/locales. Expo's supported native locales come from those files.
Tests check catalog completeness, placeholders, regional matching and persistence;
they do not substitute for reviewing the natural wording.

Public store listings and campaign assets remain English only. In-app language
support must not create localized store listing records.
