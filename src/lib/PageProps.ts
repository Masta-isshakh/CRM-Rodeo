export type PermissionSet = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

export type PageProps = {
  permissions: PermissionSet;
};
