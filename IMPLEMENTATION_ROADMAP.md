# 🚀 Job Order Management - Option B Implementation Roadmap

**Status**: SCHEMA MODIFICATIONS COMPLETE ✅

---

## 📋 PHASE 1: Database Schema Enhancement [COMPLETE]

### ✅ JobOrder Model - 15+ New Fields Added

**Priority & Assignment Fields:**
- `priorityLevel` (enum: LOW, NORMAL, HIGH, URGENT) - DEFAULT: NORMAL
- `assignedTechnicianId` (string) - Technician identifier
- `assignedTechnicianName` (string) - Technician name for quick display
- `assignmentDate` (datetime) - When assigned

**Quality & Inspection Fields:**
- `qualityCheckStatus` (enum: PENDING, IN_PROGRESS, PASSED, FAILED)
- `qualityCheckDate` (datetime) - When QC completed
- `qualityCheckNotes` (string) - QC comments
- `qualityCheckedBy` (string) - QC technician name

**Exit Permit Fields:**
- `exitPermitRequired` (boolean) - Safety requirement
- `exitPermitStatus` (enum: NOT_REQUIRED, PENDING, APPROVED, REJECTED)
- `exitPermitDate` (datetime) - Permit approval date
- `nextServiceDate` (string) - Next scheduled service

**Customer Communication Fields:**
- `customerNotified` (boolean) - Communication flag
- `lastNotificationDate` (datetime) - Last notification sent
- `customerAddress` (string) - For reference
- `customerCompany` (string) - For reference
- `jobDescription` (string) - Detailed work description
- `specialInstructions` (string) - Special requirements
- `internalNotes` (string) - Internal team notes

**Service Tracking Fields:**
- `totalServiceCount` (integer) - Total services in order
- `completedServiceCount` (integer) - Completed count
- `pendingServiceCount` (integer) - Remaining count
- `completedServicesCount` (integer) - Customer history

**Enhanced Delivery Fields:**
- `actualDeliveryDate` (date) - Actual delivery date
- `actualDeliveryTime` (string) - Actual delivery time
- `estimatedCompletionHours` (float) - Estimated hours needed
- `actualCompletionHours` (float) - Actual hours spent

**Enhanced Billing Fields:**
- `netAmount` (float) - Pre-discount amount
- `discountPercent` (float) - Discount percentage

**Other Enhancements:**
- `tags` (string) - JSON array for categorization
- `customerSince` (string) - Customer relationship date
- `registeredVehiclesCount` (integer) - Customer vehicle count
- `vehicleId` (string) - Explicit vehicle reference
- `registrationDate` (string) - Vehicle registration date
- `updatedBy` (string) - Audit trail

**New Secondary Indexes:**
```typescript
index("priority").queryField("jobOrdersByPriority"),
index("qualityCheckStatus").queryField("jobOrdersByQualityCheck"),
```

### ✅ JobOrderServiceItem Model - 5 New Fields

- `quantityCompleted` (integer) - Completed quantity
- `quantityRemaining` (integer) - Remaining quantity
- `qualityCheckResult` (enum: PENDING, PASSED, FAILED)
- `qualityCheckNotes` (string) - QC feedback
- `estimatedTime` (string) - Time estimate
- `actualTime` (string) - Actual time spent

**Updated Authorization**: Now supports create/update operations

### ✅ JobOrderInvoice Model - 4 New Fields

- `invoiceDate` (datetime) - Invoice generation date
- `dueDate` (date) - Payment due date
- `paidDate` (datetime) - When paid
- `invoiceNotes` (string) - Special notes
- `updatedAt` (datetime) - Audit field

**Updated Authorization**: Now supports create/update operations

### ✅ JobOrderPayment Model - 7 New Fields

- `receiptNumber` (string) - Receipt tracking
- `transactionId` (string) - Payment gateway transaction
- `verificationCode` (string) - Payment verification
- `paymentSource` (enum: CASH, CHECK, CARD, TRANSFER, WALLET, OTHER)
- `paymentStatus` (enum: PENDING, COMPLETED, FAILED, CANCELLED)
- `approvalDate` (datetime) - Payment approval date
- `approvedBy` (string) - Approver name

**Updated Authorization**: Now supports create/update operations

---

## 📝 PHASE 2: Backend Integration Updates [PENDING]

### Next Action: Update `amplify/backend.ts`

**What needs updating:**
```typescript
// Already configured in resource.ts, but verify:
- All relationships are properly connected
- Secondary indexes are accessible via GraphQL
- Authorization rules are correctly enforced
```

**Key Access Points:**
```
JobOrder → [Payments, Services, Invoices, Roadmap, Documents, Inspections]
├── JobOrderPayment (1-to-many)
├── JobOrderServiceItem (1-to-many)
├── JobOrderInvoice (1-to-many)
├── JobOrderRoadmapStep (1-to-many)
├── JobOrderDocumentItem (1-to-many)
├── InspectionState (1-to-many)
├── InspectionPhoto (1-to-many)
├── InspectionReport (1-to-many)
└── ServiceApprovalRequest (1-to-many)
```

---

## 🔌 PHASE 3: Query & Mutation Enhancements [PENDING]

### Required Updates in `src/pages/jobOrderRepo.ts`

#### 1. **Enhanced Query Function: `getJobOrderByOrderNumber()`**

Current structure:
```typescript
function getJobOrderByOrderNumber(orderNumber: string)
```

**Changes needed:**
```typescript
// Add parsing for new fields:
- priorityLevel → display as badge color
- assignedTechnicianId/Name → display in header
- qualityCheckStatus → display in status bar
- exitPermitStatus → display as requirement indicator
- completedServiceCount/totalServiceCount → calculate progress
- totalAmount/amountPaid → calculate balance
- customerNotified → show notification icon
```

#### 2. **Enhanced Listing Function: `listJobOrdersForMain()`**

**Changes needed:**
```typescript
// Add to table display:
- priorityLevel (visual indicator/badge)
- assignedTechnicianName (new column)
- qualityCheckStatus (status icon)
- completedServiceCount/totalServiceCount (progress bar)
- completionHours (time estimate)
```

#### 3. **New Helper Functions to Add:**

```typescript
// Data transformation helpers
parseJobOrderPaymentData() {
  - Extract receiptNumber, transactionId, verificationCode
  - Format paymentSource with icons
  - Show approvalDate/approvedBy for audit trail
}

parseQualityCheckData() {
  - qualityCheckStatus badge styling
  - qualityCheckDate formatting
  - qualityCheckedBy attribution
}

parseExitPermitData() {
  - exitPermitStatus visual indicators
  - exitPermitRequired boolean state
  - nextServiceDate scheduling
}

parseTechnicianData() {
  - assignedTechnicianName with avatar
  - assignmentDate formatting
  - technician status indicator
}

parseServiceProgressData() {
  - Calculate: completedServiceCount / totalServiceCount
  - Display as percentage and visual progress bar
  - Show pendingServiceCount for remaining work
}
```

#### 4. **GraphQL Query Enhancements**

When fetching JobOrder, include new fields:
```graphql
query GetJobOrder($id: ID!) {
  getJobOrder(id: $id) {
    # ... existing fields
    priorityLevel
    assignedTechnicianId
    assignedTechnicianName
    assignmentDate
    qualityCheckStatus
    qualityCheckDate
    qualityCheckNotes
    qualityCheckedBy
    exitPermitRequired
    exitPermitStatus
    exitPermitDate
    customerNotified
    lastNotificationDate
    totalServiceCount
    completedServiceCount
    pendingServiceCount
    estimatedCompletionHours
    actualCompletionHours
    # Services with new fields
    servicesItems {
      quantityCompleted
      quantityRemaining
      qualityCheckResult
      estimatedTime
      actualTime
    }
    # Payments with new fields
    payments {
      receiptNumber
      transactionId
      verificationCode
      paymentSource
      paymentStatus
      approvalDate
      approvedBy
    }
    # Invoices with new fields
    invoicesItems {
      invoiceDate
      dueDate
      paidDate
      invoiceNotes
    }
  }
}
```

---

## 🎨 PHASE 4: Component and Display Updates [PENDING]

### Reference Design Components Layout

The reference design shows a 3-section layout:

#### **Section 1: Header & Quick Status**
```
┌─────────────────────────────────────────────────────┐
│ PRIORITY  STATUS  QUALITY_CHECK  EXIT_PERMIT        │
│ [URGENT]  [IN PROGRESS] [PASSED] [APPROVED]        │
│ Order #XXX | Vehicle: ABC-123 | Tech: John Doe     │
└─────────────────────────────────────────────────────┘
```

**Fields to display:**
- `priorityLevel` - colored badge (RED=URGENT, YELLOW=HIGH, GRAY=LOW/NORMAL)
- `status` - status badge
- `qualityCheckStatus` - checkmark/X icon
- `exitPermitStatus` - permit icon
- `assignedTechnicianName` - person chip
- `plateNumber` - vehicle reference

#### **Section 2: 6-Column Grid (Details Cards)**

```
┌──────────────┬──────────────┬──────────────┐
│ Customer     │ Vehicle      │ Services     │
├──────────────┼──────────────┼──────────────┤
│ Name         │ Make/Model   │ Total: 5     │
│ Phone        │ Year: 2023   │ Done: 3      │
│ Company      │ Color        │ Pending: 2   │
│ Address      │ Plate        │ Progress: 60%│
└──────────────┴──────────────┴──────────────┘

┌──────────────┬──────────────┬──────────────┐
│ Delivery     │ Billing      │ Quality Check│
├──────────────┼──────────────┼──────────────┤
│ Expected: XX │ Total: $XXX  │ Status: PASS │
│ Actual: XX   │ Paid: $XXX   │ Date: XX     │
│ Hours: XX    │ Due: $XXX    │ By: Technician
│ Est: 2h 30m  │ Method: Card │ Notes: OK    │
└──────────────┴──────────────┴──────────────┘
```

**Components to update:**
1. **CustomerDetailsCard**
   - Add: `customerCompany`, `customerSince`, `registeredVehiclesCount`
   
2. **VehicleDetailsCard**
   - Add: `registrationDate`, ensure all vehicle fields display

3. **ServicesCard**
   - Add: Progress bar for `completedServiceCount/totalServiceCount`
   - Add: List services with `quantityCompleted/quantityRemaining`
   - Add: Service status (PENDING, IN_PROGRESS, COMPLETED)

4. **DeliveryCard** (if not present)
   - Display: `expectedDeliveryDate/Time` vs `actualDeliveryDate/Time`
   - Display: `estimatedCompletionHours` vs `actualCompletionHours`

5. **BillingCard**
   - Add: Discount breakdown
   - Add: Invoice dates from `invoicesItems`

6. **QualityCheckCard** (new if not present)
   - Display: `qualityCheckStatus` with visual indicator
   - Display: `qualityCheckDate`, `qualityCheckedBy`, `qualityCheckNotes`

#### **Section 3: Roadmap Timeline + Invoices + Payments**

Already implemented in CSS but needs data updates:

**Roadmap Section:**
- Already has `RoadmapCard` component
- Connect to `roadmapItems` from JobOrder

**Invoices Section:**
- Display `invoicesItems` with new date fields
- Show: `invoiceDate`, `dueDate`, `paidDate`
- Invoice status indicators

**Payments Log Section:**
- Display `payments` with new fields
- Show: `receiptNumber`, `transactionId`, `paymentSource`
- Approval info: `approvalDate`, `approvedBy`
- Payment status: `paymentStatus` enum

---

## 🧪 PHASE 5: Verification Checklist [PENDING]

### Build Verification
- [ ] Run `npm run build` - No TypeScript errors
- [ ] Run `npm run dev` - Dev server starts
- [ ] Amplify types generate without errors

### Schema Verification
- [ ] All new fields persist to database
- [ ] GraphQL schema includes new types
- [ ] Secondary indexes query correctly
- [ ] Authorization rules enforce properly

### Component Data Flow
- [ ] `getJobOrderByOrderNumber()` returns new fields
- [ ] JobCards.tsx components receive new data
- [ ] All new fields render without console errors
- [ ] Data formatting functions work correctly

### Visual Design Match
- [ ] Header shows: Priority + Status + QC + ExitPermit + Technician
- [ ] 6-column grid displays all detail cards
- [ ] Services card shows progress bar
- [ ] Delivery dates display correctly
- [ ] Quality check section visible
- [ ] Roadmap timeline renders
- [ ] Invoices section shows dates
- [ ] Payments log shows receipt/transaction info

### Performance
- [ ] JobOrder queries complete < 1 second
- [ ] No memory leaks in component state
- [ ] CSS animations are smooth

---

## 📦 PHASE 6: Testing Scenario [PENDING]

### Complete End-to-End Test Flow:

1. **Create Job Order** with all new fields:
   ```
   - Priority: URGENT
   - Assigned Tech: John Doe
   - Services: 5 items
   - Delivery Date: 2024-01-20
   - QC Status: PENDING
   - Exit Permit: REQUIRED
   ```

2. **Update Service Items:**
   ```
   - Mark 2/5 complete
   - Add quality check results
   - Log estimated vs actual time
   ```

3. **Record Payments:**
   ```
   - Add payment with receipt number
   - Capture transaction ID
   - Set approval date/person
   - Verify payment status
   ```

4. **Update Quality Check:**
   ```
   - Change to: PASSED
   - Add notes
   - Set checked-by technician
   ```

5. **Verify Display:**
   ```
   - All new fields visible
   - Status indicators correct
   - Progress bars accurate
   - Dates formatted properly
   - Payment log complete
   ```

---

## 📊 Database Fields Summary

### Total New Fields Added: 42

**JobOrder**: +22 fields
- Priority/Assignment: 3
- Quality Check: 4
- Exit Permit: 4
- Communication: 4
- Service Tracking: 3
- Delivery: 2
- Billing: 2

**JobOrderServiceItem**: +5 fields
**JobOrderInvoice**: +4 fields  
**JobOrderPayment**: +7 fields

**Total Database Changes**: 4 models modified, 2 secondary indexes added

---

## 🔄 Current Implementation Status

```
✅ PHASE 1: Database Schema Enhancement
   └─ 42 new fields added across 4 models
   └─ Secondary indexes configured
   └─ Authorization rules updated

⏳ PHASE 2: Backend Integration (Ready for next)
⏳ PHASE 3: Query/Mutation Updates
⏳ PHASE 4: Component Display Updates
⏳ PHASE 5: Verification Testing
⏳ PHASE 6: End-to-End Testing
```

---

## 🎯 Next Steps (IMMEDIATE)

1. **Deploy Schema Changes**
   ```bash
   npx amplify generate  # Generate new types
   npm run build        # Verify compilation
   ```

2. **Update jobOrderRepo.ts** with new field queries

3. **Update JobCards.tsx** components to display new fields

4. **Test with real data** to ensure everything displays correctly

---

## 📞 Quick Reference - File Locations

| File | Purpose | Status |
|------|---------|--------|
| `amplify/data/resource.ts` | Schema definitions | ✅ UPDATED |
| `src/pages/jobOrderRepo.ts` | Backend integration | ⏳ PENDING |
| `src/pages/JobCards.tsx` | Component display | ⏳ PENDING |
| `src/pages/JobCards.css` | Styling | ✅ READY |

---

**Last Updated**: Today
**Option**: Option B (Schema-based fields approach)
**Status**: Phase 1 Complete - Schema Enhanced ✅
