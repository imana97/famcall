"""Maintain and validate FamCall's English store copy. No upload side effects."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'metadata'
DATE = '2026-11-07'

description = '''A little signal. A familiar voice.

FamCall is a simple way to call the people who matter, designed with weak and unstable internet connections in mind.

Just voice. Just your people.
Open your contacts, choose someone, and start a one-to-one voice call. Both people use FamCall, so a familiar voice is only a few taps away.

Get started with your phone number
Verify your number and stay signed in. There is no password to remember. Add people from your contacts with your permission, or enter a phone number with its country code.

Made for imperfect connections
FamCall focuses on keeping conversation understandable when bandwidth is limited. If the connection is interrupted, it tries to reconnect and shows you what is happening.

Keep it simple
One-to-one voice calls. A clear contact list. An easy way to answer, talk, and hang up. Recent and missed calls, with blocking when you need it.

Both people need FamCall and an internet connection. Call availability and performance depend on the connection at each end. Mobile data charges may apply.

Questions or feedback? Contact info@silvergridtech.com.

FamCall is developed by SilverGrid Technology LLC.'''

apple = {
    'name': 'FamCall: Simple Voice Calls',
    'subtitle': 'Voice calls for weak networks',
    'promotional_text': 'A little signal. A familiar voice. Simple voice calls designed for weak and unstable internet connections, so you can focus on the people who matter.',
    'keywords': 'family,friends,phone,audio,low bandwidth,unstable internet,stay connected',
    'description': description,
    'copyright': '2026 SilverGrid Technology LLC',
}
google = {
    'title': 'FamCall: Simple Voice Calls',
    'short_description': 'Simple voice calls designed for weak and unstable internet connections',
    'full_description': description,
    'developer_name': 'SilverGrid Technology LLC',
    'support_email': 'info@silvergridtech.com',
}
beta = {
    'testflight_description': '''FamCall is a simple voice-calling app designed with weak and unstable internet connections in mind.

This internal test version focuses on phone-number signup, adding contacts, incoming calls, two-way voice, and recovery after short connection interruptions. Both callers need the test app and internet access.

Help us find the moments when a call takes too long to ring, speech becomes hard to follow, or reconnection needs improvement. Send feedback through TestFlight or email info@silvergridtech.com.

This is an early test version from SilverGrid Technology LLC. Features and performance may change before release.''',
    'testflight_what_to_test': '''Use two test phones with this FamCall build installed.

1. Verify your phone number and reopen the app. Check that you remain signed in.
2. Add someone from contacts, then try adding a number manually with its country code. Try again with contact access declined.
3. Call in both directions. Check that both people can hear and understand each other.
4. Try an incoming call with the receiving phone locked and the app in the background.
5. During a call, switch between Wi-Fi and mobile data. Briefly lose the connection, then restore it. Note whether speech returns and how long it takes.
6. Try speakerphone, headphones, mute, declining a call, and hanging up from either end.

Include the app build, phone model, OS version, approximate time and timezone, connection type at each end, whether a VPN was used, and the steps that caused the problem. If a diagnostic reference is shown, include it.

Do not include verification codes, passwords, other people's phone numbers, contact lists, or recordings of private conversations. Use the feedback address info@silvergridtech.com.''',
    'testflight_feedback_email': 'info@silvergridtech.com',
    'play_internal_release_notes': '''Initial FamCall internal test build.

Includes phone-number verification, manual and device-contact entry, outgoing and incoming one-to-one voice calls, call controls, and reconnection after supported network interruptions.

This version is intended for testing before public release.''',
    'production_release_notes': '''Initial FamCall release with phone-number verification, optional device-contact access, manual contact entry, one-to-one voice calls, incoming-call controls, and reconnection after supported network interruptions.''',
}

limits = {
    'apple': {'name': 30, 'subtitle': 30, 'promotional_text': 170, 'keywords': 100, 'description': 4000},
    'google-play': {'title': 30, 'short_description': 80, 'full_description': 4000},
    'beta': {'testflight_description': 4000, 'testflight_what_to_test': 4000, 'play_internal_release_notes': 500, 'production_release_notes': 500},
}

metadata = {
    'schema_version': 1,
    'locale': 'en-US',
    'checked_on': DATE,
    'status': 'PUBLIC LISTING DRAFT — Android internal code 4 and TestFlight build 3 from fecda429 are available, verified 7 November 2026 04:27 UTC. Final-candidate privacy reports, release screenshots, production call reliability and public-store review remain pending',
    'publisher': 'SilverGrid Technology LLC',
    'support_email': 'info@silvergridtech.com',
    'brand': {'name': 'FamCall', 'headline': 'A little signal. A familiar voice.', 'positioning': 'Simple voice calls designed for weak and unstable internet connections.', 'geographic_targeting_in_public_copy': False},
    'apple': apple,
    'google_play': google,
    'beta': beta,
    'submission_configuration': {
        'marketing_url': 'https://famcall.web.app',
        'desired_marketing_url': 'https://famcall.web.app',
        'support_url': 'https://famcall.web.app',
        'privacy_policy_url': 'https://famcall.web.app/privacy',
        'external_account_deletion_url': 'https://famcall.web.app/delete-account',
        'url_status': 'Protected website-only workflow 42339257054 deployed source 5ace4bb, including the revised privacy and deletion notices. All four pages returned HTTP 200 and byte-matched that source on 7 November 2026 at 04:39 UTC; see website-delivery-2026-11-07.json. The homepage provides the support email link.',
        'apple_bundle_id': 'com.silvergridtech.famcall',
        'android_application_id': 'com.silvergridtech.famcall',
        'apple_sku': 'famcall-ios',
        'apple_app_id': '6831551843',
        'initial_version': '0.1.0',
        'apple_primary_category_proposed': 'Social Networking',
        'google_play_category_proposed': 'Communication',
        'pricing': None,
        'minimum_os_versions': None,
        'ipad_supported': False,
        'age_rating_questionnaire': None,
        'target_audience_and_content_questionnaire': None,
        'contains_ads': False,
        'app_privacy_answers': None,
        'google_data_safety_answers': None,
        'encryption_export_compliance': None,
        'internal_testing_export_declaration': {
            'ios_build': '2',
            'encryption': 'Standard encryption outside or in addition to Apple OS encryption',
            'france_distribution': False,
            'owner_approved_and_saved_on': DATE,
            'scope': 'Internal build 2 cleared Apple Missing Compliance; build 3 reused the same approved answer. See encryption-answer.txt. Reassess before France distribution or encryption changes; public-release compliance remains pending.'
        },
        'review_contact_name': None,
        'review_contact_phone': None,
        'review_contact_email': 'info@silvergridtech.com',
        'review_account_a': None,
        'review_account_b': None,
        'review_access_instructions': None,
        'testflight_join_url': None,
        'google_play_internal_opt_in_url': 'https://play.google.com/apps/internaltest/4700744436494600533',
        'app_store_url': None,
        'google_play_url': None,
    },
    'claims_requiring_release_evidence': [
        'Phone verification and durable sign-in are implemented and verified.',
        'Manual entry and optional contacts access work with normalized international numbers.',
        'Two-way calling, background ringing, and call controls work on supported platforms.',
        'Automatic reconnection and its status UI work under the documented network tests.',
        'Weak-network positioning is supported by measured speech and connection results.'
    ],
    'do_not_claim_without_evidence': ['works offline', 'never drops calls', 'works everywhere', 'guaranteed connection', 'free or unlimited', 'end-to-end encrypted', 'no data collected', 'no tracking', 'no recordings'],
}

report = {'checked_on': DATE, 'result': 'PASS', 'checks': [], 'scope': 'Text lengths and basic brand restrictions only; not store approval or functional validation.'}
for group, fields in [('apple', apple), ('google-play', google), ('beta', beta)]:
    folder = META / 'en-US' / group
    folder.mkdir(parents=True, exist_ok=True)
    for field, content in fields.items():
        (folder / f'{field}.txt').write_text(content + '\n', encoding='utf-8')
        if field in limits[group]:
            measured = len(content.encode('utf-8')) if group == 'apple' and field == 'keywords' else len(content)
            limit = limits[group][field]
            assert measured <= limit, (group, field, measured, limit)
            report['checks'].append({'field': f'{group}.{field}', 'length': measured, 'limit': limit, 'unit': 'bytes' if group == 'apple' and field == 'keywords' else 'characters', 'pass': True})

public_text = '\n'.join([*apple.values(), *google.values(), *beta.values()]).lower()
for prohibited in ['guaranteed', 'works offline', 'never drops', 'unlimited', 'end-to-end encrypted']:
    assert prohibited not in public_text, prohibited
report['brand_check'] = 'PASS: location-neutral public copy; no unverified absolute reliability, price, or encryption promises.'
(META / 'metadata.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
(META / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
