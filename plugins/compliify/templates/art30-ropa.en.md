# Record of Processing Activities (Art. 30 GDPR)

> This document is generated deterministically from the governance facts
> recorded in the repository (as of commit {{meta.as_of}}). It is not legal
> advice. Unknown information is not hidden: it is marked as open.

**System:** {{identity.system_name}}
**Stage:** {{lifecycle.status}}

## 1. Controller and system (Art. 30(1)(a) GDPR)

- System name: {{identity.system_name}}
- Accountable owner: {{identity.owner}}
- Description: {{identity.description}}
- AI model in use: {{model.model_id}} (provider: {{model.provider}}, how it is run: {{model.hosting}})

## 2. Purposes of the processing (Art. 30(1)(b) GDPR)

- Purpose of the processing: {{context.purpose}}
- Business area: {{context.domain}}
- Legal basis (Art. 6 GDPR): {{context.legal_basis}}

## 3. Categories of data subjects and of personal data (Art. 30(1)(c) GDPR)

- Categories of data subjects: {{context.affected_persons}}
- Categories of data processed: {{data.categories}}
- Special categories of personal data (Art. 9 GDPR): {{data.special_category}}

## 4. Recipients and transfers to third countries (Art. 30(1)(d) and (e) GDPR)

- Categories of recipients: {{data.recipients}}
- Region the data is sent to (including model API calls): {{data.egress_region}}

## 5. Erasure periods and technical and organisational measures (Art. 30(1)(f) and (g) GDPR)

- Envisaged time limits for erasure: {{data.retention}}
- Access control / authentication: {{controls.auth}}
- Logging: {{controls.logging}}
- Redaction / pseudonymisation of personal data: {{controls.pii_redaction}}
- Encryption of stored data: {{controls.encryption}}
- Credentials in the source code: {{controls.secrets_in_code}}

## 6. Automated decision-making (Art. 22 GDPR)

- Kind of output: {{behavior.output_type}}
- Degree of autonomy: {{behavior.autonomy}}
- Human review of outputs (human in the loop): {{behavior.human_in_loop}}
- Effect of the outputs on the people concerned: {{context.decision_effect}}

## Annex A - Facts and where they come from

All active facts this document is generated from:

{{#facts_table}}

## Annex B - Open items

The following information is not yet confirmed and needs to be settled in review:

{{#unknowns}}
