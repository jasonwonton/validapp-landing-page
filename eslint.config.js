import globals from "globals";
const shared = { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.serviceworker, BarcodeDetector: "readonly" } };
const newSources = ["app/friends/index.js", "app/friends/model.js", "app/activity.js", "app/ask-compose.js", "app/parent-access.js", "app/parent-approval.js", "app/chat/direct-draft.js", "app/chat/drafts.js"];
export default [
    { ignores: ["dist/**", "node_modules/**", "app/friends/qr.js"] },
    { files: ["app/app.js", "app/api.js", "app/chat/index.js", "app/chat/outbox.js", "app/chat/people.js", "app/chat/activity-settings.js", "app/camera/send-to.js", "app/comments/index.js", "app/routes/feed.js", "app/routes/chats.js", "app/demo-api.js", "app/ui-icons.js", "app/ui-dialogs.js", "assets/add-link.js", ...newSources], languageOptions: shared, rules: { "no-undef": "error", "no-unreachable": "error", "no-dupe-class-members": "error", "no-constant-condition": ["error", { checkLoops: false }] } },
    { files: newSources, rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }] } },
];
