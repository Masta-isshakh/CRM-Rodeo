$ErrorActionPreference = 'Stop'

$checks = @(
  @{ n='page_dashboard'; f='src/components/MainLayout.tsx'; p='moduleId="dashboard" optionId="dashboard_list"' },
  @{ n='page_customers'; f='src/components/MainLayout.tsx'; p='moduleId="customers" optionId="customers_list"' },
  @{ n='page_vehicles'; f='src/components/MainLayout.tsx'; p='moduleId="vehicles" optionId="vehicles_list"' },
  @{ n='page_tickets'; f='src/components/MainLayout.tsx'; p='moduleId="tickets" optionId="tickets_list"' },
  @{ n='page_employees'; f='src/components/MainLayout.tsx'; p='moduleId="employees" optionId="employees_list"' },
  @{ n='page_activity'; f='src/components/MainLayout.tsx'; p='moduleId="activitylog" optionId="activitylog_list"' },
  @{ n='page_jobcards'; f='src/components/MainLayout.tsx'; p='moduleId="joborder" optionId="joborder_list"' },
  @{ n='page_jobhistory'; f='src/components/MainLayout.tsx'; p='moduleId="jobhistory" optionId="jobhistory_list"' },
  @{ n='page_serviceexec'; f='src/components/MainLayout.tsx'; p='moduleId="serviceexec" optionId="serviceexec_list"' },
  @{ n='page_payment'; f='src/components/MainLayout.tsx'; p='moduleId="payment" optionId="payment_list"' },
  @{ n='page_quality'; f='src/components/MainLayout.tsx'; p='moduleId="qualitycheck" optionId="qualitycheck_list"' },
  @{ n='page_exitpermit'; f='src/components/MainLayout.tsx'; p='moduleId="exitpermit" optionId="exitpermit_list"' },
  @{ n='page_calltracking'; f='src/components/MainLayout.tsx'; p='moduleId="calltracking" optionId="calltracking_list"' },
  @{ n='page_inspection'; f='src/components/MainLayout.tsx'; p='moduleId="inspection" optionId="inspection_list"' },
  @{ n='page_users'; f='src/components/MainLayout.tsx'; p='moduleId="users" optionId="users_list"' },
  @{ n='page_departments'; f='src/components/MainLayout.tsx'; p='moduleId="departments" optionId="departments_list"' },
  @{ n='page_rolespolicies'; f='src/components/MainLayout.tsx'; p='moduleId="rolespolicies" optionId="rolespolicies_list"' },

  @{ n='action_dashboard_kpis'; f='src/pages/Dashboard.tsx'; p='dashboard_kpis' },
  @{ n='action_dashboard_quicknav'; f='src/pages/Dashboard.tsx'; p='dashboard_quicknav' },
  @{ n='action_dashboard_revenue'; f='src/pages/Dashboard.tsx'; p='dashboard_revenue' },
  @{ n='action_dashboard_activity'; f='src/pages/Dashboard.tsx'; p='dashboard_activity' },
  @{ n='action_dashboard_calendar'; f='src/pages/Dashboard.tsx'; p='dashboard_calendar' },
  @{ n='action_activity_view'; f='src/pages/ActivityLogs.tsx'; p='moduleId="activitylog" optionId="activitylog_view"' },
  @{ n='action_employees_refresh'; f='src/pages/Employees.tsx'; p='moduleId="employees" optionId="employees_refresh"' },
  @{ n='action_joborder_discount_percent'; f='src/pages/JobCards.tsx'; p='moduleId="joborder" optionId="joborder_discount_percent"' },
  @{ n='action_payment_max_discount'; f='src/pages/PaymentInvoiceManagment.tsx'; p='payment_max_discount_percent' },
  @{ n='action_qc_finish'; f='src/pages/QualityCheckModule.tsx'; p='moduleId="qualitycheck" optionId="qualitycheck_finish"' },
  @{ n='action_qc_approve'; f='src/pages/QualityCheckModule.tsx'; p='qualitycheck_approve' },
  @{ n='action_qc_reject'; f='src/pages/QualityCheckModule.tsx'; p='qualitycheck_reject' },

  @{ n='sync_compute_rolepolicy'; f='src/pages/RolesPoliciesAdmin.tsx'; p='computeRolePoliciesFromOptions' },
  @{ n='sync_rolepolicy_update'; f='src/pages/RolesPoliciesAdmin.tsx'; p='RolePolicy.update' },
  @{ n='sync_rolepolicy_create'; f='src/pages/RolesPoliciesAdmin.tsx'; p='RolePolicy.create' }
)

$rows = foreach ($c in $checks) {
  $ok = (Select-String -Path $c.f -Pattern $c.p -SimpleMatch | Measure-Object).Count -gt 0
  [pscustomobject]@{
    name = $c.n
    status = if ($ok) { 'PASS' } else { 'FAIL' }
    file = $c.f
  }
}

$pass = ($rows | Where-Object status -eq 'PASS' | Measure-Object).Count
$fail = ($rows | Where-Object status -eq 'FAIL' | Measure-Object).Count

"TOTAL=$($rows.Count) PASS=$pass FAIL=$fail"
$rows | Sort-Object name | Format-Table -AutoSize
if ($fail -gt 0) {
  "FAILED_CHECKS:"
  $rows | Where-Object status -eq 'FAIL' | Select-Object -ExpandProperty name
}
