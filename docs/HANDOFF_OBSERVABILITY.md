# Handoff observability definitions

Dashboard panels: queue ready, processing, retrying, completed and dead-letter
counts; oldest-ready age; open cases; SLA breaches; publication outcomes; alert
delivery outcomes; replay count; lease recovery count; and worker-cycle errors.
Break down only by safe event/provider/status labels—never traveler, session,
hotel, credential, or provider payload data.

Alert rules use the configured queue-depth and oldest-age thresholds. Page on
database readiness failure, any SLA breach sustained for two polls, dead letters,
or a publication/alert failure ratio above 20% for 10 minutes with at least five
attempts. Warn on lease recoveries or retry growth. Deduplicate by reason and UTC
hour; resolve only after two healthy polls. Link alerts to the runbook and retain
correlation IDs, counts, error codes, and timestamps only.
