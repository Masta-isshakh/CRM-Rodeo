import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

import { auth } from "./auth/resource";
import { customMessage } from "./auth/custom-message/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";

import { inviteUser } from "./functions/invite-user/resource";
import { setUserActive } from "./functions/set-user-active/resource";
import { deleteUser } from "./functions/delete-user/resource";
import { updateUserProfile } from "./functions/update-user-profile/resource";

import { listDepartments } from "./functions/departments/list-departments/resource";
import { createDepartment } from "./functions/departments/create-department/resource";
import { deleteDepartment } from "./functions/departments/delete-department/resource";
import { renameDepartment } from "./functions/departments/rename-department/resource";
import { setUserDepartment } from "./functions/departments/set-user-department/resource";
import { adminCognito } from "./functions/adminCognito/resource";

import { myGroups } from "./functions/auth/my-groups/resource";
import { sendSms } from "./functions/send-sms/resource";
import { processSmsEvents } from "./functions/process-sms-events/resource";
import { resolveDriveShareLink } from "./functions/resolve-drive-share-link/resource";
import { driveRetentionCleanup } from "./functions/drive-retention-cleanup/resource";
import { processSmsDeliveryStatus } from "./functions/process-sms-delivery-status/resource";

const SMS_AUDIT_TOPIC_ARN = "arn:aws:sns:ap-south-1:115246381405:Rodeo_Drive_Topic.fifo";
const SMS_AUDIT_QUEUE_ARN = "arn:aws:sqs:ap-south-1:115246381405:Rodeo_Drive_Queue.fifo";

const backend = defineBackend({
  auth,
  customMessage,
  data,
  storage,


  inviteUser,
  setUserActive,
  deleteUser,
  updateUserProfile,

  listDepartments,
  createDepartment,
  deleteDepartment,
  renameDepartment,
  setUserDepartment,
  adminCognito,

  myGroups,
  sendSms,
  processSmsEvents,
  resolveDriveShareLink,
  driveRetentionCleanup,
  processSmsDeliveryStatus,
});

// ---- myGroups Lambda needs permission to read Cognito groups ----
// Gen2 often types resources.lambda as an interface; cast to CDK Function to use helpers. :contentReference[oaicite:1]{index=1}
const myGroupsFn = backend.myGroups.resources.lambda as unknown as lambda.Function;

myGroupsFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:AdminListGroupsForUser"],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// Optional (handler already falls back to AMPLIFY_AUTH_USERPOOL_ID, but this is fine too)
myGroupsFn.addEnvironment("USER_POOL_ID", backend.auth.resources.userPool.userPoolId);

const adminCognitoFn = backend.adminCognito.resources.lambda as unknown as lambda.Function;

adminCognitoFn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:ListUsers",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:ListGroups",
      "cognito-idp:ListUsersInGroup",
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

adminCognitoFn.addEnvironment("USERPOOL_ID", backend.auth.resources.userPool.userPoolId);

const sendSmsFn = backend.sendSms.resources.lambda as unknown as lambda.Function;
const processSmsEventsFn = backend.processSmsEvents.resources.lambda as unknown as lambda.Function;

const importedSmsAuditTopic = sns.Topic.fromTopicArn(sendSmsFn, "ImportedSmsAuditTopic", SMS_AUDIT_TOPIC_ARN);
const importedSmsAuditQueue = sqs.Queue.fromQueueArn(processSmsEventsFn, "ImportedSmsAuditQueue", SMS_AUDIT_QUEUE_ARN);

sendSmsFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["sns:Publish"],
    resources: ["*"],  // SNS Direct Publish requires * (phone number, not topic)
  })
);
sendSmsFn.addEnvironment("SMS_AUDIT_TOPIC_ARN", SMS_AUDIT_TOPIC_ARN);

processSmsEventsFn.addEnvironment("SMS_AUDIT_TOPIC_ARN", SMS_AUDIT_TOPIC_ARN);
processSmsEventsFn.addEnvironment("SMS_AUDIT_QUEUE_ARN", SMS_AUDIT_QUEUE_ARN);

// Ensure SQS consume permissions are attached with proper dependency ordering.
importedSmsAuditQueue.grantConsumeMessages(processSmsEventsFn);

processSmsEventsFn.addEventSource(
  new SqsEventSource(importedSmsAuditQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
  })
);

const processSmsDeliveryStatusFn =
  backend.processSmsDeliveryStatus.resources.lambda as unknown as lambda.Function;
const resolveDriveShareLinkFn =
  backend.resolveDriveShareLink.resources.lambda as unknown as lambda.Function;
const driveRetentionCleanupFn =
  backend.driveRetentionCleanup.resources.lambda as unknown as lambda.Function;

backend.storage.resources.bucket.grantRead(resolveDriveShareLinkFn);
backend.storage.resources.bucket.grantReadWrite(driveRetentionCleanupFn);

const storageBucketName = backend.storage.resources.bucket.bucketName;

resolveDriveShareLinkFn.addEnvironment("FILE_STORAGE_BUCKET", storageBucketName);
driveRetentionCleanupFn.addEnvironment("FILE_STORAGE_BUCKET", storageBucketName);

resolveDriveShareLinkFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedHeaders: ["*"],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedOrigins: ["*"],
  },
});

new events.Rule(resolveDriveShareLinkFn, "DriveRetentionCleanupDaily", {
  schedule: events.Schedule.cron({ minute: "0", hour: "2" }),
  targets: [new targets.LambdaFunction(driveRetentionCleanupFn)],
});

// SMS Delivery Status Lambda permissions
processSmsDeliveryStatusFn.addEnvironment("SMS_AUDIT_TOPIC_ARN", SMS_AUDIT_TOPIC_ARN);

const customMessageFn = backend.customMessage.resources.lambda as unknown as lambda.Function;

customMessageFn.addPermission("AllowCognitoInvokeCustomMessage", {
  principal: new ServicePrincipal("cognito-idp.amazonaws.com"),
  action: "lambda:InvokeFunction",
  sourceArn: backend.auth.resources.userPool.userPoolArn,
});
