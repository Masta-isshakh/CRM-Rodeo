# RBAC Document Visibility and Refund QA Checklist

## Scope
- Verify global document-type visibility enforcement for:
  - Payment/Bill documents
  - Exit Permit documents
  - Inspection documents
  - Quality Check documents
- Verify cancelled fully paid refund behavior and post-refund transition.

## Pre-Checks
- Ensure seed data includes at least one order with each document type generated.
- Ensure at least one cancelled order has payments recorded (fully paid, not yet refunded).
- Prepare 2 roles:
  - Role A: all four document toggles enabled.
  - Role B: selectively disable one document toggle at a time.

## Toggle Matrix
- payment_documents
- exitpermit_documents
- inspection_documents
- qualitycheck_documents

## Test Flow Per Toggle
1. Sign in as Role B and disable exactly one document toggle for the module under test.
2. Visit the source module page and confirm the related document is not visible in its Documents section.
3. Open Payment & Invoice details for a relevant order and confirm hidden document does not appear there.
4. Open Job Order History details for the same order and confirm hidden document does not appear there.
5. Confirm shared billing surface behavior:
   - If payment_documents is OFF: Bill ID row and invoice list are hidden.
   - If payment_documents is ON: Bill ID row and invoice list are visible.
6. Confirm download controls for hidden document artifacts are not available.
7. Re-enable the toggle and verify the document type reappears everywhere it is expected.

## Document-Type Specific Checks
1. Bill document checks (payment_documents)
- Validate Bill PDF artifacts are hidden globally when OFF.
- Validate invoice list and bill references are hidden in shared billing cards when OFF.

2. Exit Permit document checks (exitpermit_documents)
- Validate exit permit files are hidden in Exit Permit details and Job Order History details when OFF.

3. Inspection document checks (inspection_documents)
- Validate inspection report files are hidden in Inspection details and Job Order History details when OFF.

4. Quality Check document checks (qualitycheck_documents)
- Validate quality check report files are hidden in QC details and Job Order History details when OFF.

## Refund Transition Validation
1. Use a cancelled order that is fully paid.
2. Open Payment & Invoice details and confirm Refund action is available.
3. Execute a partial refund:
- Confirm order remains visible in Payment & Invoice list.
- Confirm paid amount decreases and balance/status updates correctly.
4. Execute refund until paid amount reaches zero.
- Confirm order disappears from Payment & Invoice list.
- Confirm order appears in Job Order History.
- Confirm final payment status in history aligns with unpaid/refunded financial state.

## Cross-Tab / Session Sanity
- Open two tabs with the same user.
- Repeat one toggle test to ensure visibility stays consistent across navigations.

## Expected Outcome
- Document visibility is enforced globally by document type, not only on source pages.
- Payment cancelled/refund lifecycle behaves as:
  - Cancelled + paid > 0: still refundable and visible in Payment & Invoices.
  - Cancelled + paid = 0: no longer in Payment & Invoices and present in Job Order History.
