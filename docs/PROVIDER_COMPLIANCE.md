# Provider and outreach compliance boundary

Reviewed: 2026-08-08. Policy and law can change; re-check before each operational launch. This document describes product controls, not legal advice.

Public Simbi homepage, terms section3.4(b) and privacy policy were specifically re-read on2026-10-02; the public automated-query/script, unsolicited-message and non-consensual harvesting restrictions remain published. This refresh does not attest to current review of the other jurisdictional sources below, provider approval, account access or actual operator compliance. Exact scope is recorded in [the readiness ledger](PRODUCTION_READINESS.md#windows-firefox-revalidation-2026-10-02).

## Simbi

On2026-10-02, the public homepage, full terms restriction in section3.4(b), privacy-policy material and Rules page were directly refreshed again. The published automated-query/script, unsolicited/duplicative-message and non-consensual harvesting restrictions remain visible; Rules is member-content/conduct guidance, not account-flow evidence. Personal use of one's own account does not itself establish authorization for prohibited provider automation. No login, account inspection, contact harvesting or sending occurred in this refresh, and no other jurisdictional source below was freshly verified. This is a bounded public-source observation, not legal certification or provider approval.

Simbi's [Terms and Conditions](https://simbi.com/terms-and-conditions) prohibit unsolicited or duplicative messages, harvesting user data, scraping/mining, automated searches/queries, and automated agents/scripts. Its [Privacy Policy](https://simbi.com/privacy-policy) describes member data and the rights attached to personal data. Its [Rules](https://simbi.com/rules) govern member content and conduct.

Therefore this product:

- has no scraper, browser driver, automated login, provider password field, form filler, or send endpoint;
- accepts only manually supplied or otherwise authorized prospect context;
- requires a human to open the original source and review relevance;
- requires campaign purpose and lawful-context notes;
- requires a human approval checklist for every draft;
- prepares a copyable message and same-host provider link only;
- requires the human operator to send and record the exact result;
- maintains suppressions and blocks opted-out prospects;
- exposes an emergency pause.

There is no evidence of an approved official Simbi messaging API in the audited repository or cited provider materials. Any future provider connector must remain disabled until written authorization, documented scopes, credential verification, quota handling, sandbox tests, and an updated threat/compliance review exist.

## Commercial email

The US Federal Trade Commission's [CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) explains that commercial email rules can apply to individual and business-to-business messages, require truthful headers/subjects and a physical address, and require a working opt-out process honored promptly. Simbi messaging is not assumed to be email, but campaign content should still avoid deception and make declining easy.

## EU direct marketing

The European Commission states that people have a [right to object to direct marketing](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals/what-happens-if-someone-objects-my-company-processing-their-personal-data_en) and that processing for that purpose must stop when they object. Operators must identify and document the lawful basis, minimize stored data, explain the use at first contact where required, and retain suppression evidence so an objection is not forgotten.

## Required operator review

Before activating a campaign, confirm:

1. The source was obtained and stored lawfully.
2. The planned contact is permitted by the platform and applicable jurisdiction.
3. The message is relevant to the recipient's actual context and is not deceptive.
4. The recipient can easily decline.
5. The operator can record and honor an objection promptly.
6. No automation will log in, scrape, send, or disguise the operator's identity.
