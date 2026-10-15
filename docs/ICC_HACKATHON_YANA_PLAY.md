# YANA Play — ICC Global Hackathon direction

## One-line proposition

YANA Play is a WhatsApp-first personal sports companion that makes women's sport easier to discover, understand, follow, and share without requiring a new app or expensive device.

## Problem and chosen track

The prototype targets **Sport Visibility & Engagement** first and **Next-Gen Fan Experiences** second. Women's sport is growing, but discovery remains fragmented: fixtures, athlete stories, explainers, and fan communities live across different apps and often assume strong connectivity and existing sports knowledge.

YANA Play meets fans where they already are. A short conversation learns the sports, teams, topics, language, and accessibility needs a fan chooses. It returns three concise, source-labelled items at a time: an athlete story, a fixture or watch opportunity, and a participatory challenge.

## What changes from YANA travel

| YANA travel boundary           | YANA Play equivalent                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| Destination and service intent | Sport, team, athlete, competition, or fan intent                          |
| Hotel/experience provider      | Authorized fixture, editorial, community, or ticketing adapter            |
| Search criteria                | Fan-declared interests, language, location, and accessibility needs       |
| Normalized inventory result    | Normalized fixture, athlete story, fan challenge, or community event      |
| Ranking and three-item pages   | Relevance plus an explicit women's-sport visibility objective             |
| Booking recheck                | Fixture/ticket/source freshness verification before a transactional claim |
| Itinerary                      | Match-day plan and personalized tournament journey                        |
| Human handoff                  | Safeguarding, accessibility, ticketing, or community moderator handoff    |

The AI boundary remains unchanged: AI may interpret intent or create friendly summaries, but deterministic code validates inputs, chooses providers, ranks results, records consent, and refuses unsupported live claims.

## Prototype architecture

```text
WhatsApp / web demo
  -> existing Twilio, OpenWA, or Meta message normalization
  -> fan profile and consent preferences
  -> deterministic intent routing
  -> SportsFanExperienceService
     -> authorized ICC data adapter (planned)
     -> partner editorial/community adapters (planned)
     -> safe provider fallback
  -> normalized content with provenance and freshness
  -> relevance + representation ranking
  -> three accessible cards per message
  -> participation, reminder, share, or human-support action
```

The working slice is available at `GET /sports`; its JSON boundary is `POST /sports/api/feed`. Demo content is fictional and marked non-authoritative. The adapter contract is ready for an approved ICC or partner data source; it does not scrape or imply ICC authorization.

## USP

Most sports products optimize feeds for engagement after a fan installs an app. YANA Play optimizes for **access before attention**: WhatsApp reach, three-card simplicity, multilingual/voice delivery, transparent sources, and measurable representation of women's sport. Representation is part of the ranking objective, not a separate campaign page.

## Judging alignment

- **Innovation:** combines conversational personalization with a deterministic visibility objective and source-aware content safety.
- **Technical execution:** reuses tested multi-provider messaging, profile, state, fallback, pagination, voice, and human-handoff boundaries. The new sports engine is independently testable.
- **Women in sport:** prioritizes women-focused items when the fan opts in; future dashboards can report impression, completion, sharing, and follow conversion by competition without inferring gender.
- **Ecosystem value:** gives fans discovery and participation, athletes more reachable storytelling, and partners attributable calls to action.
- **Sustainability and inclusion:** no new app or dedicated device; concise low-bandwidth cards; existing translation and optional voice paths; accessibility mode is explicit.
- **Storytelling:** a judge can personalize the demo and see three explainable results immediately.

## Pilot plan

1. Agree on one authorized competition feed and editorial source with ICC or a partner.
2. Co-design content and safeguarding rules with women athletes, fans, and at least one woman product/engineering lead.
3. Pilot with one tournament, two languages, and WhatsApp opt-in cohorts.
4. Measure discovery-to-follow conversion, story completion, repeat participation, source clicks, women-sport impression share, and user-reported accessibility.
5. Add reminders only with explicit consent and provide one-message opt-out.

## Five-slide submission outline

1. **Invisible to unmissable:** the discovery gap and one fan story.
2. **Meet YANA Play:** personalized, participatory women's sport in WhatsApp.
3. **Live demo:** choose interests, receive three explainable cards, act or share.
4. **Why it can ship:** YANA architecture, authorized-source boundary, fallback, accessibility, and pilot metrics.
5. **The ask:** an ICC data/content pilot and athlete/fan co-design access.

## Deliberate prototype limits

- No live ICC data, marks, endorsement, or official athlete facts are claimed.
- No fixture, score, ticket, or availability claim is authoritative until an approved adapter verifies it.
- Health or performance recommendations are out of scope for this slice because they require clinical, sports-science, privacy, and safeguarding governance.
- The demo does not infer gender, disability, age, or other sensitive traits.
