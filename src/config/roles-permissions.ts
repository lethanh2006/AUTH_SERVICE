export const RolePermissions: Record<string, string[]> = {
  user: [
    'schedule:read-own',
    'schedule:create',
    'attendance:scan',
    'attendance:read-own',
    'policy:read'
  ],

  admin: [
    '*' // Admin gets wildcard access to all permissions
  ]
};
