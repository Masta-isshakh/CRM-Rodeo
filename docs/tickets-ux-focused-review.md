# Tickets UX Focused Review (Comments, SLA, Attachments)

Date: 2026-06-07

## Scope

Focused review of the new Tickets UX for missing operational fields:
- Comments / conversation thread
- SLA / due tracking
- Attachments

## Evidence Snapshot

Current Tickets UI and create/update payloads in `src/pages/Tickets.tsx` only handle:
- `customerId`
- `title`
- `description`
- `status`
- `priority`
- `assignedTo`
- `createdAt` (create)

Data model in `amplify/data/resource.ts` includes:
- `Ticket` with relation `comments: hasMany(TicketComment)`
- `TicketComment` model (`ticketId`, `message`, `author`, `createdAt`)

No Ticket model fields were found for:
- SLA target date/time
- SLA breach state
- attachments / file references

## Findings (Ordered by Severity)

1. High: Ticket comments are modeled in backend but not surfaced in Tickets UX.
   - Impact: Agents/technicians cannot maintain ticket conversation history in the ticket flow.
   - Risk: Context moves to external channels (chat/calls), reducing auditability.
   - Evidence:
     - `Ticket.comments` relation exists in schema.
     - No `client.models.TicketComment.*` usage in `src/pages/Tickets.tsx`.

2. High: No SLA fields or SLA status in Ticket schema and UX.
   - Impact: No way to set/track target response or resolution times.
   - Risk: No at-risk/overdue visibility, harder operational accountability.
   - Evidence:
     - Ticket schema has status/priority but no due/target/SLA fields.
     - Tickets page has no SLA input, badge, or filter.

3. Medium: No attachment support in Ticket schema or UX.
   - Impact: Teams cannot attach screenshots/documents needed for issue triage.
   - Risk: Slower resolution cycles due to missing evidence.
   - Evidence:
     - No attachment fields/relations on Ticket model.
     - Tickets page has no upload/list/download UI.

## Focused QA Checklist

Use this checklist during the final UX pass.

### A) Comments

- [ ] User can add a comment to a ticket from ticket details/card.
- [ ] Existing comments are shown in reverse chronological order.
- [ ] Comment shows author and timestamp.
- [ ] Empty comment submission is blocked with user-visible validation.
- [ ] Permissions enforced for add/edit/delete comment actions.

### B) SLA

- [ ] Ticket create flow supports SLA target (date/time) OR explicit policy-based SLA assignment.
- [ ] Ticket list/card shows SLA state (`On track`, `At risk`, `Breached`).
- [ ] SLA state changes correctly with current time and ticket status.
- [ ] Closed/resolved tickets are excluded from active breach counts (or clearly labeled if retained).
- [ ] Filter/sort supports SLA state or due-time prioritization.

### C) Attachments

- [ ] Ticket supports uploading one or more attachments.
- [ ] Allowed type/size limits are validated with clear error messages.
- [ ] Attachment list shows name, uploader, upload time.
- [ ] User can download/view attachments from ticket context.
- [ ] Permissions enforced for upload/delete.

### D) Regression Safety

- [ ] Create/edit/delete ticket still works with existing fields.
- [ ] Search and status filter behavior remains correct.
- [ ] Mobile layout remains usable for new fields/actions.
- [ ] Arabic/English labels added for any new strings.

## Recommended Next Implementation Slice

1. Implement comments first (already partially modeled):
   - Add Ticket details panel/expansion.
   - Read/write `TicketComment` records scoped by `ticketId`.
2. Add SLA fields to `Ticket` model:
   - `slaTargetAt` (datetime)
   - `slaStatus` (`ON_TRACK | AT_RISK | BREACHED` or computed in UI)
3. Add attachment model and storage wiring:
   - `TicketAttachment` (`ticketId`, `fileKey`, `fileName`, `contentType`, `sizeBytes`, `uploadedBy`, `createdAt`)

## Exit Criteria for This Review

This review passes when all checklist items in sections A-C are either:
- implemented and validated, or
- explicitly marked out-of-scope with product sign-off.
