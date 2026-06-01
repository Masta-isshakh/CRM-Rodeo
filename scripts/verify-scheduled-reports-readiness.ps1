param(
  [Parameter(Mandatory = $true)]
  [string]$AppId,

  [Parameter(Mandatory = $true)]
  [string]$SenderEmail,

  [string]$Region = "eu-west-1",
  [string]$RuleName = "ProcessScheduledReportsEveryMinute"
)

$ErrorActionPreference = "Stop"

$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Name,
    [bool]$Pass,
    [string]$Detail
  )

  $results.Add([pscustomobject]@{
      Check  = $Name
      Status = if ($Pass) { "PASS" } else { "FAIL" }
      Detail = $Detail
    }) | Out-Null
}

function Run-AwsJson {
  param(
    [string]$Command,
    [switch]$AllowFailure
  )

  try {
    $raw = Invoke-Expression "$Command"
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return $null
    }
    return $raw | ConvertFrom-Json
  }
  catch {
    if ($AllowFailure) {
      return $null
    }
    throw
  }
}

Write-Host "Running Scheduled Reports readiness checks..." -ForegroundColor Cyan
Write-Host "AppId=$AppId Region=$Region SenderEmail=$SenderEmail" -ForegroundColor DarkCyan

try {
  $awsCmd = Get-Command aws -ErrorAction Stop
  Add-Result -Name "AWS CLI installed" -Pass $true -Detail $awsCmd.Source
}
catch {
  Add-Result -Name "AWS CLI installed" -Pass $false -Detail "aws command not found"
}

$identity = Run-AwsJson -Command "aws sts get-caller-identity --output json" -AllowFailure
if ($null -ne $identity -and $identity.Account) {
  Add-Result -Name "AWS credentials valid" -Pass $true -Detail "Account=$($identity.Account) Arn=$($identity.Arn)"
}
else {
  Add-Result -Name "AWS credentials valid" -Pass $false -Detail "Unable to call sts get-caller-identity"
}

$currentRegion = ""
try {
  $currentRegion = (aws configure get region).Trim()
  if (-not $currentRegion) {
    $currentRegion = (aws configure get default.region).Trim()
  }
}
catch {
  $currentRegion = ""
}

if ([string]::IsNullOrWhiteSpace($currentRegion)) {
  Add-Result -Name "AWS CLI region configured" -Pass $false -Detail "No region configured in aws profile"
}
else {
  Add-Result -Name "AWS CLI region configured" -Pass ($currentRegion -eq $Region) -Detail "Configured=$currentRegion Expected=$Region"
}

$sesAccount = Run-AwsJson -Command "aws sesv2 get-account --region $Region --output json" -AllowFailure
if ($null -ne $sesAccount) {
  $prodEnabled = [bool]$sesAccount.ProductionAccessEnabled
  Add-Result -Name "SES production access" -Pass $prodEnabled -Detail "ProductionAccessEnabled=$prodEnabled"
}
else {
  Add-Result -Name "SES production access" -Pass $false -Detail "Unable to query sesv2 get-account in $Region"
}

$senderIdentity = Run-AwsJson -Command "aws sesv2 get-email-identity --region $Region --email-identity $SenderEmail --output json" -AllowFailure
if ($null -ne $senderIdentity) {
  $verified = [bool]$senderIdentity.VerifiedForSendingStatus
  Add-Result -Name "SES sender identity verified" -Pass $verified -Detail "Sender=$SenderEmail VerifiedForSendingStatus=$verified"
}
else {
  Add-Result -Name "SES sender identity verified" -Pass $false -Detail "Identity not found or not accessible: $SenderEmail"
}

$appInfo = Run-AwsJson -Command "aws amplify get-app --app-id $AppId --region $Region --output json" -AllowFailure
if ($null -ne $appInfo -and $null -ne $appInfo.app) {
  Add-Result -Name "Amplify app exists" -Pass $true -Detail "Name=$($appInfo.app.name)"
}
else {
  Add-Result -Name "Amplify app exists" -Pass $false -Detail "AppId not found in region $Region"
}

$lambdaName = ""
try {
  $lambdaName = (aws lambda list-functions --region $Region --query "Functions[?contains(FunctionName, 'process-scheduled-reports')].FunctionName | [0]" --output text).Trim()
}
catch {
  $lambdaName = ""
}

if ([string]::IsNullOrWhiteSpace($lambdaName) -or $lambdaName -eq "None") {
  Add-Result -Name "Scheduler Lambda exists" -Pass $false -Detail "process-scheduled-reports Lambda not found"
}
else {
  Add-Result -Name "Scheduler Lambda exists" -Pass $true -Detail "FunctionName=$lambdaName"

  $lambdaCfg = Run-AwsJson -Command "aws lambda get-function-configuration --function-name $lambdaName --region $Region --output json" -AllowFailure
  if ($null -ne $lambdaCfg) {
    $envVars = $lambdaCfg.Environment.Variables
    $sesRegion = [string]$envVars.SES_REGION
    $fromEmail = [string]$envVars.SES_FROM_EMAIL

    Add-Result -Name "Lambda SES region configured" -Pass ($sesRegion -eq $Region) -Detail "SES_REGION=$sesRegion Expected=$Region"
    Add-Result -Name "Lambda sender email configured" -Pass ($fromEmail -ieq $SenderEmail) -Detail "SES_FROM_EMAIL=$fromEmail Expected=$SenderEmail"
  }
  else {
    Add-Result -Name "Lambda SES region configured" -Pass $false -Detail "Unable to read Lambda configuration"
    Add-Result -Name "Lambda sender email configured" -Pass $false -Detail "Unable to read Lambda configuration"
  }

  $rule = Run-AwsJson -Command "aws events describe-rule --name $RuleName --region $Region --output json" -AllowFailure
  if ($null -ne $rule) {
    Add-Result -Name "EventBridge schedule rule exists" -Pass $true -Detail "Rule=$RuleName State=$($rule.State) Expression=$($rule.ScheduleExpression)"
    Add-Result -Name "EventBridge rule enabled" -Pass ($rule.State -eq "ENABLED") -Detail "State=$($rule.State)"

    $targets = Run-AwsJson -Command "aws events list-targets-by-rule --rule $RuleName --region $Region --output json" -AllowFailure
    if ($null -ne $targets -and $targets.Targets.Count -gt 0) {
      $hasLambdaTarget = $false
      foreach ($target in $targets.Targets) {
        if ($target.Arn -like "*function:$lambdaName") {
          $hasLambdaTarget = $true
          break
        }
      }
      Add-Result -Name "EventBridge target wired to Lambda" -Pass $hasLambdaTarget -Detail "Targets=$($targets.Targets.Count)"
    }
    else {
      Add-Result -Name "EventBridge target wired to Lambda" -Pass $false -Detail "No targets found for rule"
    }
  }
  else {
    Add-Result -Name "EventBridge schedule rule exists" -Pass $false -Detail "Rule not found: $RuleName"
    Add-Result -Name "EventBridge rule enabled" -Pass $false -Detail "Rule not found: $RuleName"
    Add-Result -Name "EventBridge target wired to Lambda" -Pass $false -Detail "Rule not found: $RuleName"
  }

  $logGroupName = "/aws/lambda/$lambdaName"
  $logGroup = Run-AwsJson -Command "aws logs describe-log-groups --log-group-name-prefix $logGroupName --region $Region --output json" -AllowFailure
  $hasLogGroup = $false
  if ($null -ne $logGroup -and $null -ne $logGroup.logGroups) {
    foreach ($lg in $logGroup.logGroups) {
      if ($lg.logGroupName -eq $logGroupName) {
        $hasLogGroup = $true
        break
      }
    }
  }
  Add-Result -Name "CloudWatch log group exists" -Pass $hasLogGroup -Detail "LogGroup=$logGroupName"
}

Write-Host ""
$results | Sort-Object Check | Format-Table -AutoSize

$passCount = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$total = $results.Count

Write-Host ""
if ($failCount -eq 0) {
  Write-Host "RESULT: PASS ($passCount/$total checks passed)" -ForegroundColor Green
  exit 0
}
else {
  Write-Host "RESULT: FAIL ($failCount failed, $passCount passed, total $total)" -ForegroundColor Red
  Write-Host ""
  Write-Host "Failed checks:" -ForegroundColor Yellow
  $results | Where-Object { $_.Status -eq "FAIL" } | Select-Object Check, Detail | Format-Table -AutoSize
  exit 1
}
