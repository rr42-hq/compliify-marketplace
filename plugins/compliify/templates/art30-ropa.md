# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

> Dieses Dokument wird deterministisch aus den im Repository erfassten
> Governance-Fakten generiert (Stand: Commit {{meta.as_of}}). Es ist keine
> Rechtsberatung. Unbekannte Angaben werden nicht verschwiegen, sondern
> ausdrücklich als offen gekennzeichnet.

**System:** {{identity.system_name}}
**Status:** {{lifecycle.status}}

## 1. Verantwortlicher und System (Art. 30 Abs. 1 lit. a DSGVO)

- Systemname: {{identity.system_name}}
- Fachlich verantwortlich (Owner): {{identity.owner}}
- Beschreibung: {{identity.description}}
- Eingesetztes KI-Modell: {{model.model_id}} (Anbieter: {{model.provider}}, Betriebsmodell: {{model.hosting}})

## 2. Zwecke der Verarbeitung (Art. 30 Abs. 1 lit. b DSGVO)

- Zweck der Verarbeitung: {{context.purpose}}
- Fachdomäne: {{context.domain}}
- Rechtsgrundlage (Art. 6 DSGVO): {{context.legal_basis}}

## 3. Kategorien betroffener Personen und personenbezogener Daten (Art. 30 Abs. 1 lit. c DSGVO)

- Kategorien betroffener Personen: {{context.affected_persons}}
- Kategorien verarbeiteter Daten: {{data.categories}}
- Besondere Kategorien personenbezogener Daten (Art. 9 DSGVO): {{data.special_category}}

## 4. Empfänger und Übermittlungen in Drittländer (Art. 30 Abs. 1 lit. d und e DSGVO)

- Kategorien von Empfängern: {{data.recipients}}
- Region des Datenabflusses (einschließlich Modell-API-Aufrufen): {{data.egress_region}}

## 5. Löschfristen und technisch-organisatorische Maßnahmen (Art. 30 Abs. 1 lit. f und g DSGVO)

- Vorgesehene Fristen für die Löschung: {{data.retention}}
- Zugriffskontrolle / Authentifizierung: {{controls.auth}}
- Protokollierung: {{controls.logging}}
- Redaktion / Pseudonymisierung personenbezogener Daten: {{controls.pii_redaction}}
- Verschlüsselung ruhender Daten: {{controls.encryption}}
- Zugangsdaten im Quellcode: {{controls.secrets_in_code}}

## 6. Automatisierte Entscheidungsfindung (Art. 22 DSGVO)

- Art der Systemausgabe: {{behavior.output_type}}
- Autonomiegrad des Systems: {{behavior.autonomy}}
- Menschliche Prüfung der Ausgaben (Human in the Loop): {{behavior.human_in_loop}}
- Wirkung der Ausgaben für betroffene Personen: {{context.decision_effect}}

## Anhang A - Faktenlage mit Herkunft

Alle aktiven Fakten, aus denen dieses Dokument generiert wurde:

{{#facts_table}}

## Anhang B - Offene Punkte

Die folgenden Angaben sind noch nicht bestätigt und im Review zu klären:

{{#unknowns}}
