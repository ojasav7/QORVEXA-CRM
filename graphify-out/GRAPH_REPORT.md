# Graph Report - .  (2026-08-18)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2373 nodes · 6491 edges · 119 communities (103 shown, 16 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cb8b7e0a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- src/App.tsx
- post
- db.ts
- db
- del
- lib/ai.ts
- notFound
- dependencies
- cn
- api.ts
- lib/events.ts
- RevenuePage.tsx
- fields.ts
- sidebar.tsx
- environment.ts
- lib/revenue.ts
- lib/security.ts
- lib/agents.ts
- object-service.ts
- AnalyticsPage.tsx
- lib/brain.ts
- emitEvent
- tickets.ts
- utils.ts
- server/index.ts
- routes/cdp.ts
- devDependencies
- api
- devDependencies
- dependencies
- badRequest
- SuccessPage.tsx
- Layout.tsx
- pagination.tsx
- lib/automations.ts
- lib/campaigns.ts
- LandingPage.tsx
- email.ts
- CustomersPage.tsx
- scripts
- compilerOptions
- components.json
- telephony.ts
- lib/journeys.ts
- metrics.ts
- EcosystemPage.tsx
- command.tsx
- menubar.tsx
- format.ts
- form.tsx
- compilerOptions
- oauth.ts
- JourneysPage.tsx
- carousel.tsx
- routes/auth.ts
- forecasts.ts
- routes/brain.ts
- ubq.ts
- chart.tsx
- simulate.ts
- qorvexacrm/package.json
- include
- routes/tokens.ts
- builder.ts
- timemachine.ts
- command.ts
- lib/contracts.ts
- memory.ts
- routes/portability.ts
- breadcrumb.tsx
- navigation-menu.tsx
- select.tsx
- access.ts
- toggle-group.tsx
- lib
- import.ts
- ErrorBoundary
- verify-phase14.sh
- verify-phase2-comm.sh
- verify-phase3.sh
- verify-phase4.sh
- verify-phase5.sh
- verify-phase8.sh
- build.mjs
- verify-phase1.sh
- verify-phase10.sh
- verify-phase11.sh
- verify-phase12.sh
- verify-phase13.sh
- verify-phase15.sh
- verify-phase2.sh
- verify-phase6.sh
- verify-phase7.sh
- verify-phase9.sh
- createSecurityAlert
- totpCode
- runRetentionScan
- useAsync.ts
- security-checklist.sh
- clsx
- date-fns
- @radix-ui/react-avatar
- @radix-ui/react-checkbox
- @radix-ui/react-hover-card
- @radix-ui/react-progress
- @radix-ui/react-scroll-area
- @radix-ui/react-select
- @radix-ui/react-tabs
- @radix-ui/react-toggle
- @radix-ui/react-toggle-group
- react-day-picker
- vite-tsconfig-paths
- types

## God Nodes (most connected - your core abstractions)
1. `db()` - 430 edges
2. `cn()` - 220 edges
3. `badRequest()` - 189 edges
4. `emitEvent()` - 188 edges
5. `notFound()` - 145 edges
6. `post()` - 119 edges
7. `timeAgo()` - 70 edges
8. `asyncHandler()` - 66 edges
9. `ok()` - 65 edges
10. `del()` - 63 edges

## Surprising Connections (you probably didn't know these)
- `createObjectService()` --indirect_call--> `get()`  [INFERRED]
  server/lib/object-service.ts → src/lib/api.ts
- `include` --extends--> `vite.config.ts`  [EXTRACTED]
  qorvexacrm/tsconfig.json → tsconfig.json
- `AlertDialogOverlay` --calls--> `cn()`  [EXTRACTED]
  qorvexacrm/src/components/ui/alert-dialog.tsx → qorvexacrm/src/lib/utils.ts
- `AlertDialogContent` --calls--> `cn()`  [EXTRACTED]
  qorvexacrm/src/components/ui/alert-dialog.tsx → qorvexacrm/src/lib/utils.ts
- `AlertDialogHeader()` --calls--> `cn()`  [EXTRACTED]
  qorvexacrm/src/components/ui/alert-dialog.tsx → qorvexacrm/src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (119 total, 16 thin omitted)

### Community 0 - "src/App.tsx"
Cohesion: 0.04
Nodes (76): FeatureState, Session, SessionCtx, ToastCtx, Props, Badge(), badgeColors, badgeDots (+68 more)

### Community 1 - "post"
Cohesion: 0.04
Nodes (72): StatCard(), post(), dateTime(), timeAgo(), BuilderTab(), BuildResult, CATEGORY_TONE, CommandResult (+64 more)

### Community 2 - "db.ts"
Cohesion: 0.07
Nodes (52): dbHealthy(), server, assertActiveUser(), getUser(), requireAuth(), requireRole(), asyncHandler(), errorHandler() (+44 more)

### Community 3 - "db"
Cohesion: 0.06
Nodes (73): db(), declareCampaignWinner(), simulateDeliverabilityEvent(), deliver(), dispatchWebhooks(), Actor, cancelVisit(), cancelWorkOrder() (+65 more)

### Community 4 - "del"
Cohesion: 0.04
Nodes (69): ADR-0013, RequireAuth(), useSession(), del(), patch(), User, BookingPage, BookingPageModal() (+61 more)

### Community 5 - "lib/ai.ts"
Cohesion: 0.05
Nodes (71): aiCatalog(), ALL_CAPABILITIES, analyzeSentiment(), clamp(), CONFIDENCE_THRESHOLD, contextFor(), DEFAULT_MODELS, defaultFirewallPolicy() (+63 more)

### Community 6 - "notFound"
Cohesion: 0.08
Nodes (62): notFound(), accountHealth(), addMilestone(), addQbr(), addSurveyResponse(), autoConvertReferrals(), awardPoints(), churnAccounts() (+54 more)

### Community 7 - "dependencies"
Cohesion: 0.03
Nodes (63): class-variance-authority, cmdk, embla-carousel-react, @hookform/resolvers, input-otp, dependencies, class-variance-authority, cmdk (+55 more)

### Community 8 - "cn"
Cohesion: 0.06
Nodes (52): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, Card, CardContent (+44 more)

### Community 9 - "api.ts"
Cohesion: 0.06
Nodes (53): useToast(), Alert(), Drawer(), PageHeader(), downloadCsv(), ENV_STORAGE_KEY, fetchWithRetry(), getEnvHeader() (+45 more)

### Community 10 - "lib/events.ts"
Cohesion: 0.05
Nodes (42): ADR-0010, env, isDev, ADR-0009, ADR-0028, parseWorkflowParts(), BookingPageConfig, drainMockInbound() (+34 more)

### Community 11 - "RevenuePage.tsx"
Cohesion: 0.05
Nodes (48): money(), actionIcon(), actionTool(), Agent, AgentAction, AgentDetail(), AgentMemory, AgentRun (+40 more)

### Community 12 - "fields.ts"
Cohesion: 0.06
Nodes (38): AuditInput, changedFields(), writeAudit(), findPipeline(), getDefaultPipeline(), normalizeStages(), normalizeStagesFromDb(), PipelineShape (+30 more)

### Community 13 - "sidebar.tsx"
Cohesion: 0.06
Nodes (40): Input, Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+32 more)

### Community 14 - "environment.ts"
Cohesion: 0.08
Nodes (38): addOrgEnvironment(), BACKUP_ROOT, BUSINESS_MODELS, createSnapshot(), pruneSnapshots(), REF_FIELDS, RestoreResult, restoreSnapshot() (+30 more)

### Community 15 - "lib/revenue.ts"
Cohesion: 0.09
Nodes (43): approveQuote(), assertQuoteTransition(), buildLines(), computeTotals(), ensureDefaultPriceBook(), getQuote(), issueInvoice(), LineItem (+35 more)

### Community 16 - "lib/security.ts"
Cohesion: 0.08
Nodes (40): ADR-0026, RFC-6238, RFC-7643, ANONYMIZE_FIELDS, base32Encode(), CONSENT_PURPOSES, createDsr(), generateRecoveryCodes() (+32 more)

### Community 17 - "lib/agents.ts"
Cohesion: 0.09
Nodes (40): AGENT_TEMPLATES, agentAnalytics(), agentMemoryFor(), agentMetering(), AgentTemplate, ALL_TOOLS, approveAction(), buildContext() (+32 more)

### Community 18 - "object-service.ts"
Cohesion: 0.10
Nodes (33): assertCanAccess(), assertAccountParentExists(), assertSafeAccountParent(), findAccount(), canRead(), canWrite(), FieldPerm, fieldPermMap() (+25 more)

### Community 19 - "AnalyticsPage.tsx"
Cohesion: 0.09
Nodes (31): ChartCard(), colorFor(), Delta(), Donut(), HBarRow(), MonthBars(), Segment, SERIES (+23 more)

### Community 20 - "lib/brain.ts"
Cohesion: 0.10
Nodes (32): ADR-0027, computeRadar(), daysSince(), dealDetective(), dealXray(), emitIfNew(), InsightInput, listInsights() (+24 more)

### Community 21 - "emitEvent"
Cohesion: 0.14
Nodes (32): templateFor(), Actor, countCustomValues(), createChangeSet(), createListing(), createPartner(), deleteListing(), diffEnvironments() (+24 more)

### Community 22 - "tickets.ts"
Cohesion: 0.08
Nodes (27): ApiError, DEFAULT_SLA_TARGETS, RESOLVED_STATUSES, responseHoursFor(), slaDueFor(), SlaStatus, slaStatusFor(), SlaSweepResult (+19 more)

### Community 23 - "utils.ts"
Cohesion: 0.07
Nodes (20): Alert, AlertDescription, AlertTitle, alertVariants, Badge(), BadgeProps, badgeVariants, Checkbox (+12 more)

### Community 24 - "server/index.ts"
Cohesion: 0.07
Nodes (27): app, clientDist, __dirname, landingDist, ADR-0009, ADR-0014, ADR-0016, RFC-7644 (+19 more)

### Community 25 - "routes/cdp.ts"
Cohesion: 0.12
Nodes (27): attachRecordEvent(), BEHAVIOR_TYPES, BehaviorInput, canonicalEmail(), ensureProfileForRecord(), findProfileByEmail(), hydrateProfile(), ingestBehavior() (+19 more)

### Community 26 - "devDependencies"
Cohesion: 0.07
Nodes (30): eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, @types/react (+22 more)

### Community 27 - "api"
Cohesion: 0.08
Nodes (22): api(), loadList(), Campaign, CampaignModal(), CampaignsPage(), Recipient, RecipientsPanel(), Segment (+14 more)

### Community 28 - "devDependencies"
Cohesion: 0.07
Nodes (27): agentation, concurrently, devDependencies, agentation, concurrently, prisma, tailwindcss, @tailwindcss/vite (+19 more)

### Community 29 - "dependencies"
Cohesion: 0.07
Nodes (27): bcryptjs, cookie-parser, dotenv, express, mongodb, dependencies, bcryptjs, cookie-parser (+19 more)

### Community 30 - "badRequest"
Cohesion: 0.09
Nodes (20): badRequest(), campaignSchema, normalizeAb(), router, ADR-0017, num(), objectRouter(), assertProductsExist() (+12 more)

### Community 31 - "SuccessPage.tsx"
Cohesion: 0.11
Nodes (25): date(), ChurnItem, ChurnTab(), CreateProgramForm(), LoyaltyTab(), Member, Opportunity, Plan (+17 more)

### Community 32 - "Layout.tsx"
Cohesion: 0.10
Nodes (18): App(), useFeature(), COMMANDS, Layout(), NAV, NotificationBell(), NotificationItem, PaletteItem (+10 more)

### Community 33 - "pagination.tsx"
Cohesion: 0.12
Nodes (21): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+13 more)

### Community 34 - "lib/automations.ts"
Cohesion: 0.12
Nodes (24): ActionOutcome, AutomationAction, AutomationCondition, AutomationTrigger, CONDITION_OPS, cooldown, cooldownCheck(), evalCondition() (+16 more)

### Community 35 - "lib/campaigns.ts"
Cohesion: 0.13
Nodes (22): audienceFor(), CampaignAb, CampaignLike, campaignStats(), deliverabilityMetrics(), sendCampaign(), subjectForVariant(), ADR-0014 (+14 more)

### Community 36 - "LandingPage.tsx"
Cohesion: 0.11
Nodes (14): App(), DemoRequest(), demoSchema, env, Errors, SubmitResult, ASCII, DIFFERENTIATORS (+6 more)

### Community 37 - "email.ts"
Cohesion: 0.13
Nodes (20): EmailProvider, EmailWebhookEvent, NormalizedEmailEvent, parseNormalizedPayload(), parseResendPayload(), parseSendgridPayload(), parseWebhookPayload(), postJson() (+12 more)

### Community 38 - "CustomersPage.tsx"
Cohesion: 0.12
Nodes (18): initials(), Behavior, BEHAVIOR_LABEL, CallRow, CustomersPage(), GraphDeal, Health, healthBar() (+10 more)

### Community 39 - "scripts"
Cohesion: 0.10
Nodes (19): description, name, private, scripts, backfill:env, backfill:pipeline, build, db:generate (+11 more)

### Community 40 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, jsx, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+12 more)

### Community 41 - "components.json"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 42 - "telephony.ts"
Cohesion: 0.17
Nodes (16): aiStatus(), CapabilityStatus, emailStatus(), integrationsStatus(), telephonyStatus(), ADR-0028, authHeader(), fetchCallRecording() (+8 more)

### Community 43 - "lib/journeys.ts"
Cohesion: 0.17
Nodes (18): advanceEnrollment(), CONDITION_OPS, enroll(), evalCondition(), EVENT_ENTITY, executeStep(), handleEvent(), JOURNEY_EVENT_TRIGGERS (+10 more)

### Community 44 - "metrics.ts"
Cohesion: 0.18
Nodes (18): computeAllMetrics(), computeMetricsFor(), DashboardKind, DEFAULT_THRESHOLDS, evaluateThresholds(), marketingMetrics(), Metric, MetricGroup (+10 more)

### Community 45 - "EcosystemPage.tsx"
Cohesion: 0.13
Nodes (17): AppsTab(), badge(), ChangeSet, ChangeSetItem, EcosystemPage(), FieldDef, Impact, InstalledApp (+9 more)

### Community 46 - "command.tsx"
Cohesion: 0.12
Nodes (14): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut() (+6 more)

### Community 47 - "menubar.tsx"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 48 - "format.ts"
Cohesion: 0.13
Nodes (12): usd, ContactOption, DealOption, EmailPage(), Message, MessageModal(), statusTone, CATEGORIES (+4 more)

### Community 49 - "form.tsx"
Cohesion: 0.19
Nodes (12): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+4 more)

### Community 50 - "compilerOptions"
Cohesion: 0.13
Nodes (15): node, compilerOptions, baseUrl, esModuleInterop, isolatedModules, jsx, module, moduleResolution (+7 more)

### Community 51 - "oauth.ts"
Cohesion: 0.17
Nodes (12): SESSION_COOKIE, sessionCookieOpts(), clientIp(), deviceLabel(), issueSession(), resolveSession(), sign(), completeLogin() (+4 more)

### Community 52 - "JourneysPage.tsx"
Cohesion: 0.13
Nodes (13): Enrollment, EnrollmentsPanel(), FIELD_OPTIONS, Journey, JourneyModal(), JourneysPage(), OPS, Segment (+5 more)

### Community 53 - "carousel.tsx"
Cohesion: 0.19
Nodes (13): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+5 more)

### Community 54 - "routes/auth.ts"
Cohesion: 0.18
Nodes (13): createMfaToken(), createSessionCookie(), loadSession(), SessionUser, sign(), verifyLegacy(), verifyMfaToken(), consumeRecoveryCode() (+5 more)

### Community 55 - "forecasts.ts"
Cohesion: 0.22
Nodes (13): bucketPipeline(), churnRisk(), conversionLikelihood(), ForecastBuckets, ForecastOwnerRow, ForecastStageRow, liveForecast(), ltvEstimate() (+5 more)

### Community 56 - "routes/brain.ts"
Cohesion: 0.32
Nodes (10): createOrchestrator(), deleteOrchestrator(), getOrchestrator(), listDelegations(), listOrchestrators(), testOrchestrator(), updateOrchestrator(), asOfSchema (+2 more)

### Community 57 - "ubq.ts"
Cohesion: 0.27
Nodes (11): dimensionOf(), entityOf(), filtersOf(), Intent, metricOf(), money(), monthlyMrr(), timeWindowStart() (+3 more)

### Community 58 - "chart.tsx"
Cohesion: 0.25
Nodes (9): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, getPayloadConfigFromPayload(), THEMES (+1 more)

### Community 59 - "simulate.ts"
Cohesion: 0.29
Nodes (10): activeSeats(), currentMrr(), listSimulations(), monthlyMrr(), runScenario(), runSimulation(), ScenarioModel, simulationModels() (+2 more)

### Community 60 - "qorvexacrm/package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, format, lint, preview (+1 more)

### Community 61 - "include"
Cohesion: 0.20
Nodes (8): include, eslint.config.js, server, src, src/**/*.ts, src/**/*.tsx, include, vite.config.ts

### Community 62 - "routes/tokens.ts"
Cohesion: 0.29
Nodes (8): loadTokenAuth(), hashToken(), issueToken(), newToken(), TokenScopes, tokenSessionUser(), createSchema, router

### Community 63 - "builder.ts"
Cohesion: 0.27
Nodes (9): builderCatalog(), buildFromPrompt(), BuildResult, OBJECT_TYPES, pickEntity(), pickName(), resolveBuilt(), slugify() (+1 more)

### Community 64 - "timemachine.ts"
Cohesion: 0.24
Nodes (9): compareStates(), createSnapshot(), FULL_COLLECTIONS, getSnapshot(), listSnapshots(), reconstruct(), RECORD_TYPES, retentionDays() (+1 more)

### Community 65 - "command.ts"
Cohesion: 0.33
Nodes (8): AccessUser, classify(), commandCatalog(), CommandResult, findContactByName(), findOpportunityByName(), quoted(), runCommand()

### Community 66 - "lib/contracts.ts"
Cohesion: 0.28
Nodes (8): analyzeContract(), Clause, extractClauses(), signContract(), terminateContract(), toDate(), ADR-0020, ADR-0022

### Community 67 - "memory.ts"
Cohesion: 0.33
Nodes (8): actorFor(), fingerprintFor(), forgetMemory(), learnFrom(), listMemory(), MemoryInput, recordMemory(), startMemoryEngine()

### Community 68 - "routes/portability.ts"
Cohesion: 0.31
Nodes (7): BACKUP_ROOT, COLLECTIONS, deleteExportFile(), PORTABILITY_ROOT, PortabilityResult, resolveExportFile(), router

### Community 69 - "breadcrumb.tsx"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 70 - "navigation-menu.tsx"
Cohesion: 0.29
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 71 - "select.tsx"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 72 - "access.ts"
Cohesion: 0.29
Nodes (7): AccessUser, listConditions(), listWhere(), ScopedRecord, ADR-0008, VISIBILITY_ORG, VISIBILITY_OWNER

### Community 73 - "toggle-group.tsx"
Cohesion: 0.43
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 74 - "lib"
Cohesion: 0.29
Nodes (7): lib, DOM, ES2022, lib, DOM, DOM.Iterable, ES2022

### Community 75 - "import.ts"
Cohesion: 0.33
Nodes (4): parseCsv(), bodySchema, DryRunRow, router

### Community 76 - "ErrorBoundary"
Cohesion: 0.29
Nodes (3): ErrorBoundary, Props, State

### Community 77 - "verify-phase14.sh"
Cohesion: 0.52
Nodes (4): bad(), check(), ok(), verify-phase14.sh script

### Community 78 - "verify-phase2-comm.sh"
Cohesion: 0.52
Nodes (4): bad(), check(), ok(), verify-phase2-comm.sh script

### Community 79 - "verify-phase3.sh"
Cohesion: 0.52
Nodes (4): bad(), check(), ok(), verify-phase3.sh script

### Community 80 - "verify-phase4.sh"
Cohesion: 0.52
Nodes (4): bad(), check(), ok(), verify-phase4.sh script

### Community 81 - "verify-phase5.sh"
Cohesion: 0.52
Nodes (4): bad(), check(), ok(), verify-phase5.sh script

### Community 82 - "verify-phase8.sh"
Cohesion: 0.57
Nodes (5): bad(), check(), ok(), verify-phase8.sh script, TRACK()

### Community 83 - "build.mjs"
Cohesion: 0.33
Nodes (4): landingApp, landingDist, landingOut, root

### Community 84 - "verify-phase1.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase1.sh script

### Community 85 - "verify-phase10.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase10.sh script

### Community 86 - "verify-phase11.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase11.sh script

### Community 87 - "verify-phase12.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase12.sh script

### Community 88 - "verify-phase13.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase13.sh script

### Community 89 - "verify-phase15.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase15.sh script

### Community 90 - "verify-phase2.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase2.sh script

### Community 91 - "verify-phase6.sh"
Cohesion: 0.60
Nodes (4): bad(), check(), ok(), verify-phase6.sh script

### Community 92 - "verify-phase7.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase7.sh script

### Community 93 - "verify-phase9.sh"
Cohesion: 0.67
Nodes (4): bad(), check(), ok(), verify-phase9.sh script

### Community 94 - "createSecurityAlert"
Cohesion: 0.40
Nodes (5): cidrMatch(), createSecurityAlert(), enforceSecurityPolicy(), ipAllowed(), ipv4ToInt()

### Community 95 - "totpCode"
Cohesion: 0.67
Nodes (3): base32Decode(), totpCode(), verifyTotp()

### Community 96 - "runRetentionScan"
Cohesion: 0.67
Nodes (3): recordUptimeTick(), runRetentionScan(), startSecurityEngine()

## Knowledge Gaps
- **748 isolated node(s):** `security-checklist.sh script`, `name`, `version`, `private`, `type` (+743 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createObjectService()` connect `object-service.ts` to `command.ts`, `lib/automations.ts`, `lib/campaigns.ts`, `lib/ai.ts`, `notFound`, `access.ts`, `lib/journeys.ts`, `fields.ts`, `import.ts`, `lib/agents.ts`, `AnalyticsPage.tsx`, `emitEvent`, `tickets.ts`, `server/index.ts`, `badRequest`?**
  _High betweenness centrality (0.209) - this node is a cross-community bridge._
- **Why does `get()` connect `AnalyticsPage.tsx` to `src/App.tsx`, `Layout.tsx`, `del`, `CustomersPage.tsx`, `api.ts`, `object-service.ts`, `api`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Why does `db()` connect `db` to `db.ts`, `lib/ai.ts`, `notFound`, `lib/events.ts`, `fields.ts`, `environment.ts`, `lib/revenue.ts`, `lib/security.ts`, `lib/agents.ts`, `object-service.ts`, `lib/brain.ts`, `emitEvent`, `tickets.ts`, `server/index.ts`, `routes/cdp.ts`, `badRequest`, `lib/automations.ts`, `lib/campaigns.ts`, `email.ts`, `lib/journeys.ts`, `metrics.ts`, `oauth.ts`, `routes/auth.ts`, `forecasts.ts`, `routes/brain.ts`, `ubq.ts`, `simulate.ts`, `routes/tokens.ts`, `builder.ts`, `timemachine.ts`, `command.ts`, `lib/contracts.ts`, `memory.ts`, `routes/portability.ts`, `import.ts`, `createSecurityAlert`, `runRetentionScan`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **What connects `security-checklist.sh script`, `name`, `version` to the rest of the system?**
  _748 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `src/App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.03751803751803752 - nodes in this community are weakly interconnected._
- **Should `post` be split into smaller, more focused modules?**
  _Cohesion score 0.038375350140056025 - nodes in this community are weakly interconnected._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06574074074074074 - nodes in this community are weakly interconnected._