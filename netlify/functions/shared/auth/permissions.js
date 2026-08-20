"use strict";

var ROLE_RANK = { staff: 1, admin: 2, owner: 3 };

var API_PERMISSIONS = {
  // existing web APIs
  "api-tasks:GET": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:create": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:update": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:complete": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:postpone": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:sync-todo-md": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-tasks:POST:import-todo-md": { roles: ["admin", "owner"], stepUp: false },
  "api-tasks:POST:delete": { roles: ["owner"], stepUp: true },

  "api-knowledge:GET": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-knowledge:POST:save": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-knowledge:POST:candidate-add": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-knowledge:POST:candidate-save": { roles: ["admin", "owner"], stepUp: false },
  "api-knowledge:POST:candidate-reject": { roles: ["admin", "owner"], stepUp: false },

  "api-command-history:GET": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-meeting-logs:GET": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-project-status:GET": { roles: ["staff", "admin", "owner"], stepUp: false },
  "api-line-status:GET": { roles: ["staff", "admin", "owner"], stepUp: false },

  "line-send-test:POST": { roles: ["admin", "owner"], stepUp: false },
  "api-chat-memory-reset:POST": { roles: ["owner"], stepUp: true },

  // reserved for future / local bridge
  "production-publish:POST": { roles: ["owner"], stepUp: true, adminPublishGate: true },
  "api-diary-publish:POST": { roles: ["owner"], stepUp: false },
  "api-site-publish:POST": { roles: ["owner"], stepUp: false },
  "api-site-ftp-probe:POST": { roles: ["owner"], stepUp: false },
  "ftp-upload:POST": { roles: ["owner"], stepUp: true },
  "user-admin:POST": { roles: ["owner"], stepUp: true },
  "secrets:POST": { roles: ["owner"], stepUp: true },
  "backup-restore:POST": { roles: ["owner"], stepUp: true },

  // AI development jobs → GitHub Issues (token server-side only)
  "api-github-issues:POST:create": { roles: ["owner"], stepUp: false },
  "api-github-issues:POST:sync": { roles: ["owner", "admin"], stepUp: false },
  "api-github-issues:POST:update-agent-status": { roles: ["owner"], stepUp: false }
};

function roleAtLeast(role, minimum) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimum] || 99);
}

function resolvePermission(key) {
  return API_PERMISSIONS[key] || null;
}

function roleAllowed(role, allowedRoles) {
  return Array.isArray(allowedRoles) && allowedRoles.indexOf(role) !== -1;
}

module.exports = {
  ROLE_RANK: ROLE_RANK,
  API_PERMISSIONS: API_PERMISSIONS,
  roleAtLeast: roleAtLeast,
  resolvePermission: resolvePermission,
  roleAllowed: roleAllowed
};
