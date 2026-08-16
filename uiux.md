# QORVEXA CRM — COMPLETE PRODUCT UI/UX REDESIGN & IMPLEMENTATION MASTER PROMPT

## ROLE

You are acting as the **Lead Product Designer, Senior UX Engineer, Frontend Architect, Design Systems Engineer, and QA Engineer** for the QORVEXA CRM application.

You are not being asked to simply change colors or make the interface visually attractive.

Your responsibility is to **rethink, redesign, implement, validate, and polish the entire CRM user experience** while preserving all existing business logic and functionality.

Think like a senior engineer who is building this product from scratch for real sales teams.

The final product should feel like a **premium enterprise SaaS CRM**, comparable in quality and usability to products such as HubSpot, Salesforce, Linear, Attio, Close, Notion, and modern enterprise analytics platforms — while maintaining its own QORVEXA identity.

---

# 1. PRIMARY OBJECTIVE

Transform the existing QORVEXA CRM into:

> **A premium, highly usable, green-first enterprise CRM that helps users understand their business, identify what needs attention, and take action with minimal friction.**

The redesign must improve:

* UI
* UX
* information architecture
* navigation
* visual hierarchy
* data readability
* interaction design
* accessibility
* responsive behavior
* loading states
* empty states
* error states
* forms
* tables
* filters
* search
* dashboards
* analytics
* CRM workflows
* productivity
* consistency
* perceived performance
* micro-interactions
* design-system consistency

Do NOT treat the dashboard as the only important screen.

The **entire application must eventually feel like one coherent product.**

---

# 2. ABSOLUTE DESIGN RULE

## NO PURPLE

Purple must be completely eliminated.

Search the entire frontend for:

* purple colors
* violet colors
* indigo colors
* purple Tailwind classes
* purple gradients
* purple shadows
* purple hover states
* purple focus states
* purple chart colors
* purple badges
* purple illustrations
* purple design tokens
* purple CSS variables

Do not merely change visible purple.

Remove it from the underlying design system.

Use only:

* green
* emerald
* mint
* sage
* teal
* neutral
* amber
* red

---

# 3. BRAND DESIGN SYSTEM

Create a centralized QORVEXA design system.

Do NOT scatter arbitrary colors throughout components.

Use semantic tokens.

## Core colors

```text
Background:
#F4F8F5

Surface:
#FFFFFF

Glass:
rgba(255,255,255,0.45)

Glass border:
rgba(255,255,255,0.60)

Dark sidebar:
#0F2E25

Sidebar active:
#1F8F63

Primary:
#16A34A

Deep green:
#0F766E

Sage:
#B7E4C7

Mint:
#DDF7EA

Success:
#22C55E

Teal:
#14B8A6

Warning:
#F59E0B

Danger:
#EF4444

Text primary:
#12251D

Text secondary:
#4B5D57

Border:
rgba(15,118,110,0.15)

Soft neutral:
#EEF4F1
```

---

# 4. COLOR PHILOSOPHY

Do not make everything green.

Green should communicate:

* primary action
* progress
* success
* positive performance
* active state

Use:

```text
Green      → Primary / Success
Emerald    → Positive / Growth
Teal       → Information / Active
Mint       → Soft positive background
Sage       → Secondary emphasis
Amber      → Warning / Attention
Red        → Error / Critical / Lost
Neutral    → Default / Inactive
```

Avoid excessive saturation.

The product must feel:

* mature
* trustworthy
* professional
* calm
* premium

NOT:

* playful
* childish
* overly colorful
* gamified

---

# 5. VISUAL DIRECTION

Use a **subtle glassmorphism enterprise SaaS aesthetic**.

Glassmorphism should be used intelligently.

## Heavy glass

Use for:

* top navigation
* command palette
* modal
* drawer
* floating panels
* contextual widgets

## Subtle glass

Use for:

* KPI cards
* analytics cards
* dashboard panels

## Minimal/no glass

Use for:

* dense tables
* forms
* CRM data-heavy screens
* configuration pages

The user must always be able to read information clearly.

Never sacrifice usability for aesthetics.

---

# 6. SPACING SYSTEM

Use a consistent spacing scale:

```text
4
8
12
16
20
24
32
40
48
64
```

Avoid random spacing values.

Establish consistent:

* card padding
* table spacing
* page margins
* section gaps
* modal spacing
* form spacing
* navigation spacing

---

# 7. BORDER RADIUS

Use a controlled radius system:

```text
Small controls:
8px

Inputs:
10–12px

Cards:
14–18px

Large panels:
18–20px

Modals:
20px

Pills:
999px
```

Do not make every component excessively rounded.

---

# 8. TYPOGRAPHY

Create a consistent typography hierarchy.

Prioritize:

* readability
* hierarchy
* density
* scanability

Use clear sizes for:

```text
Page title
Section title
Card title
Body
Secondary text
Caption
Table text
Labels
```

Avoid unnecessarily huge headings.

CRM users need information density.

---

# 9. PRODUCT PHILOSOPHY

The dashboard must answer three questions immediately:

### 1. How is my business doing?

Revenue, pipeline, conversion, performance.

### 2. What needs my attention?

Overdue tasks, stalled deals, follow-ups, important leads.

### 3. What should I do next?

Create lead, follow up, update deal, schedule task, contact customer.

This is more important than simply displaying analytics.

---

# 10. INFORMATION ARCHITECTURE

Reorganize navigation into logical groups.

Suggested structure:

## WORKSPACE

* Dashboard
* Leads
* Contacts
* Deals
* Pipeline

## PRODUCTIVITY

* Tasks
* Calendar
* Activities

## INSIGHTS

* Reports
* Analytics

## MANAGEMENT

* Products
* Teams
* Documents

## SYSTEM

* Settings

Do not blindly implement this structure.

First inspect the existing application and determine what modules actually exist.

Preserve existing routes and functionality.

Where possible, improve grouping without breaking deep links.

---

# 11. SIDEBAR

Build a premium dark-green sidebar.

Requirements:

* fixed
* collapsible
* responsive
* keyboard accessible
* clear active state
* subtle hover state
* tooltips when collapsed
* icons + labels
* grouped navigation
* optional notification counters

Expanded:

```text
QORVEXA
CRM

WORKSPACE
Dashboard
Leads
Contacts
Deals
Pipeline

PRODUCTIVITY
Tasks
Calendar
Activities

INSIGHTS
Reports
Analytics
```

Collapsed:

```text
🏠
👥
💼
📊
```

Do not use emoji in the actual production UI unless the existing design system intentionally supports them. Use the project's icon library.

---

# 12. TOP NAVIGATION

Create a premium glass topbar.

Include:

* global search
* keyboard shortcut indicator
* quick create
* notifications
* messages if supported
* profile
* workspace/account context

Example:

```text
Search anything...                  ⌘K

                         + New    🔔    Profile
```

The topbar should remain visually quiet.

---

# 13. GLOBAL SEARCH / COMMAND CENTER

This is a major UX feature.

Build a global search experience capable of searching across available CRM entities.

Potential entities:

* leads
* contacts
* companies
* deals
* tasks
* activities
* products
* documents

Search should support:

* keyboard shortcut
* fuzzy matching where practical
* recent searches
* grouped results
* keyboard navigation
* highlighted matching terms
* empty state
* loading state

Example:

```text
Search anything...

ACME

COMPANIES
Acme Corporation

DEALS
Acme Enterprise Deal
₹12.5L · Negotiation

CONTACTS
John Doe
john@acme.com

ACTIVITY
Proposal sent
```

Do not build fake search functionality if backend support does not exist.

If the backend already supports search, integrate it.

If it doesn't, create the UI architecture without inventing APIs.

---

# 14. QUICK CREATE

The primary "New" button should provide:

```text
+ New

Lead
Contact
Deal
Task
Activity
```

Only show entities actually supported by the application.

Make creation flows fast.

Where possible:

* preserve entered values
* avoid unnecessary fields
* validate inline
* show success feedback
* navigate intelligently after creation

---

# 15. DASHBOARD REDESIGN

Completely rethink the dashboard.

Do NOT simply place more cards on the page.

Recommended hierarchy:

```text
Header
↓
Personal greeting / context
↓
KPI summary
↓
Sales performance
↓
Pipeline overview
↓
Needs attention
↓
Recent leads / deals
↓
Activity / tasks
```

---

# 16. PERSONALIZED DASHBOARD HEADER

Example:

```text
Good morning, Arjun 👋

Here's what needs your attention today.
```

Below:

```text
3 deals need attention
5 leads require follow-up
2 tasks are overdue
```

If real data isn't available, don't fabricate it.

Use actual backend data or safe empty states.

---

# 17. KPI CARDS

Create cards for relevant metrics such as:

* Revenue
* Leads
* Conversion rate
* Pipeline value
* Tasks
* Deals won

Do not show unnecessary KPIs.

Each card should answer:

* What is the metric?
* What is its current value?
* Is it improving?
* Compared to what period?
* Can I take action?

Cards should be clickable when meaningful.

Example:

```text
Revenue

₹42.8M

↑ 18.6%

vs last 30 days

View Revenue →
```

Clicking should navigate to the relevant view or filtered report where possible.

---

# 18. SALES ANALYTICS

Create a clean main analytics panel.

Possible tabs:

```text
Revenue
Deals Won
Pipeline
Forecast
```

Provide:

* date range
* tooltip
* legend
* accessible labels
* clear axis
* responsive chart
* empty state

Avoid unnecessary visual decoration.

Charts should communicate business insights.

---

# 19. PIPELINE VISUALIZATION

Create a pipeline summary.

Show:

```text
New
Qualified
Proposal
Negotiation
Won
Lost
```

Use meaningful semantic colors.

Include:

* deal count
* total value
* conversion
* movement
* stage distribution

Provide a clear CTA:

```text
View Pipeline →
```

---

# 20. NEEDS ATTENTION

This should become one of the most important dashboard sections.

Example:

```text
⚡ Needs Attention

Acme Corporation
Deal closing soon
₹12.5L

[View Deal]

Rohan Sharma
No follow-up in 5 days

[Follow Up]

TechNova
Proposal pending

[Open Deal]
```

This section should prioritize actionable information.

Prioritize:

1. overdue
2. high-value
3. time-sensitive
4. stalled
5. normal

Do not overwhelm users.

---

# 21. TASKS

Create a clear "My Tasks" panel.

Support:

* overdue
* today
* tomorrow
* upcoming

Example:

```text
My Tasks

☐ Follow up with Acme          Today
☐ Prepare proposal             Tomorrow
☐ Call Tech Team               Jun 12

View All →
```

Allow quick completion.

---

# 22. ACTIVITY FEED

Activity feed should communicate:

* who
* what
* when
* related entity

Example:

```text
Proposal sent
Acme Corporation
2h ago

Deal moved to Negotiation
TechNova
5h ago

Call completed
BrightEdge
Yesterday
```

Keep it compact.

---

# 23. LEADS TABLE

Treat the table as a core product experience.

Prioritize:

* readability
* scanning
* sorting
* filtering
* bulk actions
* keyboard navigation
* column customization

Example:

```text
☐ Lead
Company
Status
Score
Owner
Created
Actions
```

Do not overload the default view.

---

# 24. COLUMN CUSTOMIZATION

Allow users to choose visible columns where practical.

Example:

```text
Columns

☑ Lead
☑ Company
☑ Status
☑ Score
☑ Owner

☐ Phone
☐ Email
☐ Source
☐ Created Date
```

Persist preferences where the application architecture supports it.

---

# 25. BULK ACTIONS

When rows are selected:

```text
5 selected

Assign Owner
Change Status
Add Tag
Export
Delete
```

Only expose valid actions.

Ask for confirmation before destructive operations.

---

# 26. FILTER SYSTEM

Build a reusable filter component.

Support where relevant:

* status
* owner
* source
* score
* date
* stage
* tags
* priority

Example:

```text
Filters

Status: Qualified
Owner: Arjun
Source: Website

[Clear All]
```

Show active filter count.

Allow filters to be removed individually.

---

# 27. SEARCH + FILTER UX

Search and filters must work together.

Example:

```text
Search leads...

Status: Qualified
Owner: Arjun
Source: Website
```

Result count:

```text
Showing 24 of 312 leads
```

Avoid making users wonder why results changed.

---

# 28. DEAL / CONTACT SIDE DRAWER

When selecting a row, prefer a contextual drawer when appropriate instead of immediately navigating away.

Example:

```text
Acme Corporation

₹12.5L
Negotiation
75% probability

Expected close
Jun 20

Owner
Arjun Mehta

Timeline
────────────
Proposal viewed
Email sent
Meeting completed

[View Full Deal]
[Add Activity]
```

Drawer must:

* be closable
* be keyboard accessible
* support scrolling
* preserve current table state
* avoid losing user context

---

# 29. CRM DETAIL PAGES

Every detail page should have consistent architecture.

Example:

```text
← Back

Acme Corporation

[Edit] [More]

Overview
Activity
Deals
Contacts
Files
Notes
Timeline
```

Use tabs only when there is enough content to justify them.

---

# 30. FORMS

Forms should be:

* simple
* short
* grouped logically
* validated inline
* keyboard friendly

Avoid massive forms.

Use progressive disclosure for advanced fields.

Example:

```text
Basic Information

Name
Email
Phone
Company

Additional Information
▼
```

Do not force users to fill unnecessary information.

---

# 31. FORM VALIDATION

Validation should happen near the field.

Bad:

```text
Something went wrong.
```

Good:

```text
Email address
[ rohan@ ]

Please enter a valid email address.
```

Do not clear the user's entered values after validation errors.

---

# 32. BUTTON SYSTEM

Create a consistent button hierarchy.

### Primary

```text
+ Add Lead
```

### Secondary

```text
Export
```

### Tertiary

```text
Cancel
```

### Destructive

```text
Delete Lead
```

Do not use excessive filled buttons.

The UI should have a clear visual hierarchy.

---

# 33. STATUS SYSTEM

Create reusable status badges.

Examples:

```text
New
Contacted
Qualified
Proposal
Negotiation
Won
Lost
Pending
Overdue
```

Use semantic colors consistently.

Never randomly assign colors.

---

# 34. EMPTY STATES

Every major page must have a useful empty state.

Bad:

```text
No data.
```

Good:

```text
No leads yet

Start building your sales pipeline by
adding your first lead.

[+ Add Lead]
```

For filtered results:

```text
No leads match your filters.

Try changing or clearing your filters.

[Clear Filters]
```

---

# 35. LOADING STATES

Never leave blank white screens.

Use:

* skeleton loaders
* button loading states
* table skeletons
* chart skeletons
* drawer skeletons

Avoid unnecessary spinners everywhere.

Skeletons should approximate the final layout.

---

# 36. ERROR STATES

Errors must be human-readable.

Example:

```text
Unable to load leads

Something went wrong while retrieving
your leads.

[Try Again]
```

Do not expose raw backend errors to normal users.

Log technical details appropriately.

---

# 37. TOASTS / FEEDBACK

Use a consistent notification system.

Examples:

```text
✓ Lead created successfully

✓ Deal updated

✓ Task completed

⚠ Unable to save changes
```

Do not overuse notifications.

Success notifications should disappear automatically.

Errors should remain long enough to understand and provide an action where appropriate.

---

# 38. CONFIRMATION DIALOGS

Destructive actions require confirmation.

Example:

```text
Delete Lead?

This action cannot be undone.

[Cancel] [Delete Lead]
```

For low-risk actions, avoid unnecessary confirmation dialogs.

---

# 39. MICRO-INTERACTIONS

Use subtle animation for:

* hover
* focus
* dropdown
* drawer
* modal
* toast
* button loading
* table selection
* navigation

Animation should be:

* fast
* subtle
* purposeful

Avoid flashy animations.

Respect `prefers-reduced-motion`.

---

# 40. ACCESSIBILITY

Treat accessibility as a core requirement.

Ensure:

* keyboard navigation
* visible focus states
* semantic HTML
* correct button labels
* accessible dialogs
* accessible dropdowns
* accessible tables
* sufficient contrast
* form labels
* screen-reader-friendly states

Do not rely solely on color.

For example:

Do not communicate "Lost" only with red.

Use:

```text
Lost
```

plus the red semantic color.

---

# 41. RESPONSIVE DESIGN

Design intentionally for:

### Desktop

Full sidebar + dashboard + contextual panel.

### Tablet

Collapsible sidebar + main content.

### Mobile

Bottom navigation or compact navigation.

Tables should become:

* horizontally scrollable
* card-based
* or priority-column based

Do not simply shrink everything.

---

# 42. MOBILE PRIORITIES

On mobile prioritize:

1. Dashboard summary
2. Needs attention
3. Tasks
4. Leads
5. Deals
6. Quick actions

Charts can become simplified.

Dense tables can become cards.

---

# 43. RESPONSIVE DRAWERS

Desktop:

```text
Right-side drawer
```

Mobile:

```text
Bottom sheet
```

Do not let mobile drawers consume the entire screen unnecessarily.

---

# 44. DESIGN SYSTEM ARCHITECTURE

Create reusable components rather than styling every page independently.

Examples:

```text
Button
Input
Select
Dropdown
Modal
Drawer
Tabs
Badge
Avatar
Tooltip
Toast
Card
StatCard
ChartCard
DataTable
FilterBar
SearchBar
EmptyState
ErrorState
Skeleton
PageHeader
SectionHeader
Timeline
ActivityItem
TaskItem
```

Create variants through the design system.

---

# 45. DO NOT DUPLICATE STYLES

If five screens use the same table style:

Create one reusable table system.

If multiple screens use the same filter:

Create one reusable filter component.

If multiple forms use the same input:

Create one reusable input system.

Do not create:

```text
LeadTable.jsx
DealTable.jsx
ContactTable.jsx
```

with three almost-identical styling implementations if a shared table system is appropriate.

---

# 46. DESIGN TOKENS

Centralize:

* colors
* spacing
* typography
* shadows
* radius
* transitions
* z-index
* breakpoints

If Tailwind is used, integrate the tokens into the Tailwind configuration.

If CSS variables are used, centralize them.

Do not introduce an unnecessary new styling framework.

Respect the existing stack.

---

# 47. GLASSMORPHISM TOKENS

Create controlled tokens such as:

```text
--glass-bg
--glass-border
--glass-shadow
--glass-blur
```

Use subtle values.

Do not make the entire app look frosted.

---

# 48. SHADOW SYSTEM

Use layered, subtle shadows.

Example conceptual hierarchy:

```text
Level 1 → card
Level 2 → dropdown
Level 3 → drawer
Level 4 → modal
```

Avoid heavy shadows.

---

# 49. DATA DENSITY

CRM applications need information density.

Do not make everything excessively spacious.

The objective is:

> Comfortable density, not empty luxury.

Tables should fit meaningful information without becoming cramped.

---

# 50. DASHBOARD CUSTOMIZATION

If the existing architecture allows it, consider supporting:

* date range
* team filter
* owner filter
* pipeline filter

Do not build a complex drag-and-drop dashboard system unless it is genuinely useful.

Prioritize simplicity.

---

# 51. REPORTING EXPERIENCE

Reports should not be a wall of numbers.

Use:

* charts
* comparisons
* filters
* trends
* summaries
* tables

Example:

```text
Revenue Performance

This Month
₹42.8M

↑ 18.6%

Compared with last month
```

Then provide:

```text
Revenue
Deals
Conversion
Pipeline
```

with meaningful visualizations.

---

# 52. FILTERED ANALYTICS

A major requirement is:

> User selects an attribute and the visualization updates to represent that dataset.

Example:

```text
Analyze By

○ Owner
● Source
○ Status
○ Region
```

Then:

```text
Lead Source Performance

Website       ███████████ 45%
Referral      ██████      25%
LinkedIn      █████       18%
Events        ███         12%
```

The UI should make filtering understandable.

---

# 53. USER CONTEXT

The interface should always preserve context.

For example:

If the user:

```text
Leads
→ filters Status = Qualified
→ opens Rohan
→ closes drawer
```

they should return to:

```text
Leads
Status = Qualified
same page
same sorting
same search
```

Do not unnecessarily reset the user's state.

---

# 54. URL / ROUTING STATE

Where appropriate, preserve important state in the URL.

For example:

```text
/leads?status=qualified&owner=arjun
```

This improves:

* refresh behavior
* deep linking
* sharing
* navigation
* browser history

Only implement where compatible with the existing architecture.

---

# 55. PERFORMANCE

The redesign must not create a slow application.

Pay attention to:

* unnecessary rerenders
* oversized components
* large tables
* chart rendering
* image loading
* animations
* bundle size
* unnecessary API requests

Use lazy loading for appropriate routes.

Do not introduce expensive visual effects unnecessarily.

---

# 56. TABLE PERFORMANCE

For large datasets:

* pagination
* server-side filtering where supported
* debounced search
* virtualization if genuinely required

Do not render thousands of rows unnecessarily.

---

# 57. UX FOR SLOW NETWORKS

The application should still feel responsive when API calls are slow.

Use:

* optimistic UI where safe
* skeletons
* disabled/loading buttons
* clear retry actions
* preserved user input

Never make users wonder whether their action worked.

---

# 58. PERMISSION-AWARE UI

Inspect the existing authentication and permission system.

Do not show actions users cannot perform.

For example:

If the user cannot delete:

Do not show:

```text
Delete
```

Do not rely exclusively on frontend hiding.

Backend permissions remain authoritative.

---

# 59. DO NOT BREAK EXISTING FUNCTIONALITY

This is critical.

Before changing anything:

* inspect existing routes
* inspect API clients
* inspect state management
* inspect authentication
* inspect permissions
* inspect forms
* inspect existing components
* inspect existing tests
* inspect backend contracts

The redesign is primarily a UI/UX transformation.

Do not rewrite backend business logic unnecessarily.

Do not invent APIs.

Do not create fake functionality simply to make screenshots look impressive.

---

# 60. CODEBASE DISCOVERY PHASE

Before implementing anything, perform a full repository audit.

Identify:

```text
Frontend framework
Routing
State management
API layer
Authentication
Permission system
Component library
Styling system
Charts
Tables
Forms
Testing
Build system
```

Then identify:

```text
Dashboard
Leads
Contacts
Deals
Pipeline
Tasks
Activities
Reports
Settings
```

and determine which actually exist.

Create an internal implementation map before modifying code.

---

# 61. DESIGN AUDIT

Inspect every current screen.

For each screen identify:

```text
Current problem
UX problem
Visual problem
Navigation problem
Data hierarchy problem
Accessibility problem
Responsive problem
Suggested solution
```

Do not blindly redesign screens that are already working well.

Preserve strong existing patterns.

---

# 62. USER JOURNEY AUDIT

Test these workflows:

### New user

Login
→ Dashboard
→ Understand CRM
→ Create lead

### Sales user

Dashboard
→ Needs Attention
→ Lead
→ Contact
→ Deal
→ Follow-up
→ Task

### Manager

Dashboard
→ Analytics
→ Pipeline
→ Team performance
→ Reports

### Lead management

Leads
→ Search
→ Filter
→ Select
→ View
→ Edit
→ Update status

### Deal management

Pipeline
→ Open deal
→ Move stage
→ View history
→ Add activity
→ Update close date

Fix unnecessary friction.

---

# 63. CORE UX RULE

Every major screen should have:

```text
Context
↓
Primary information
↓
Primary action
↓
Secondary actions
```

Never force users to hunt for the main action.

---

# 64. ONE PRIMARY ACTION PER CONTEXT

Avoid having five equally dominant buttons.

For example:

Lead page:

```text
+ Add Lead
```

is primary.

Everything else should be secondary.

---

# 65. REDUCE COGNITIVE LOAD

Ask for every component:

> Does this help the user accomplish something?

If not:

* remove it
* hide it
* move it
* simplify it

Do not add UI just because modern dashboards have it.

---

# 66. PROGRESSIVE DISCLOSURE

Show important information first.

Advanced information can be inside:

* expandable sections
* drawers
* tabs
* "More" menus

Do not overload the initial screen.

---

# 67. CONSISTENCY AUDIT

After implementation, verify:

* same button behavior everywhere
* same spacing everywhere
* same table patterns
* same form patterns
* same status colors
* same modal behavior
* same drawer behavior
* same empty states
* same loading states
* same toast system
* same typography hierarchy

The user should feel that every page belongs to the same product.

---

# 68. PREMIUM DETAILS

Add subtle polish:

* smooth hover transitions
* table row hover
* selected row state
* subtle card hover where appropriate
* clear focus ring
* avatar consistency
* icon alignment
* chart tooltips
* contextual actions
* keyboard shortcuts
* command palette
* breadcrumbs where useful
* sticky table headers
* sticky action bars when appropriate

Do NOT add effects just for decoration.

---

# 69. INTERACTION RULE

Every interactive element must provide feedback.

Examples:

Button:

```text
Idle
→ Hover
→ Active
→ Loading
→ Success/Error
```

Input:

```text
Default
→ Focus
→ Filled
→ Error
→ Disabled
```

Dropdown:

```text
Closed
→ Open
→ Hover
→ Selected
```

Table row:

```text
Default
→ Hover
→ Selected
```

---

# 70. KEYBOARD EXPERIENCE

Support common shortcuts where practical:

```text
/
Global search

N
New lead

D
New deal

T
New task

Esc
Close modal/drawer

Enter
Submit / select
```

Do not implement shortcuts that conflict with browser behavior or form typing.

---

# 71. COMMAND PALETTE

Implement a command palette if the existing application architecture supports it.

Example:

```text
Search commands...

Go to Dashboard
Go to Leads
Go to Deals
Create Lead
Create Deal
Create Task
Open Reports
```

This should feel fast and polished.

---

# 72. NOTIFICATIONS

Create a clear notification experience.

Group notifications:

```text
Today
Yesterday
Earlier
```

Support meaningful categories:

* task
* deal
* lead
* system

Avoid notification spam.

---

# 73. PROFILE / USER MENU

Profile menu can contain:

```text
Profile
Preferences
Keyboard shortcuts
Help
Sign out
```

Only include supported functionality.

---

# 74. MODALS

Use modals only when the user needs to focus on a task.

Do not use modals for every interaction.

Prefer:

* inline editing
* drawers
* contextual panels

when they preserve context better.

---

# 75. DELETE / DESTRUCTIVE UX

Destructive operations must be visually clear but not overly aggressive.

Example:

```text
Delete Deal?

This will permanently remove the deal.

Cancel
Delete Deal
```

Use danger red only where necessary.

---

# 76. RESPONSIVE TABLE STRATEGY

Do not blindly shrink desktop tables.

For mobile, determine the most important fields.

Example:

```text
Rohan Sharma
TechNova Pvt Ltd

Qualified · Score 85

Owner: Arjun
Created: Jun 7

[View]
```

Use cards where appropriate.

---

# 77. PRINT / EXPORT

If the application already supports export:

Ensure exported data remains functionally correct.

Do not let UI redesign break:

* CSV export
* PDF export
* reports
* downloads

---

# 78. DARK MODE

Do NOT introduce dark mode unless the existing product already supports it or it can be added cleanly.

The requested primary product direction is:

> Light enterprise SaaS + dark green navigation.

Do not expand scope unnecessarily.

---

# 79. DO NOT OVERENGINEER

Do not:

* rewrite working architecture
* replace libraries without reason
* create unnecessary abstractions
* introduce unnecessary dependencies
* rewrite backend services
* change API contracts
* build speculative features

Improve what exists.

---

# 80. IMPLEMENTATION ORDER

Execute the redesign in phases.

## PHASE 0 — DISCOVERY

Inspect repository.

Understand architecture.

Do not modify code yet.

Output an internal implementation plan.

---

## PHASE 1 — DESIGN SYSTEM

Implement:

* color tokens
* typography
* spacing
* radius
* shadows
* glass tokens
* transitions
* semantic states
* reusable primitives

---

## PHASE 2 — APP SHELL

Redesign:

* sidebar
* topbar
* global search
* profile
* notifications
* responsive shell

---

## PHASE 3 — DASHBOARD

Implement:

* greeting
* KPIs
* sales analytics
* pipeline visualization
* needs attention
* tasks
* activity
* recent leads
* responsive behavior

---

## PHASE 4 — LEADS

Redesign:

* lead list
* search
* filters
* table
* bulk actions
* create lead
* edit lead
* lead drawer
* lead details
* empty/loading/error states

---

## PHASE 5 — CONTACTS

Apply the same design system.

Focus on:

* search
* filtering
* contact details
* activity
* related deals
* contextual actions

---

## PHASE 6 — DEALS

Implement:

* deal list
* filters
* detail view
* activity timeline
* deal drawer
* probability
* expected close
* owner
* status

---

## PHASE 7 — PIPELINE

Improve:

* Kanban
* stages
* drag/drop
* filters
* search
* stage history
* deal cards
* responsive behavior

Preserve existing functionality.

---

## PHASE 8 — TASKS / ACTIVITIES / CALENDAR

Create a consistent productivity experience.

---

## PHASE 9 — REPORTS / ANALYTICS

Transform reports from number-heavy screens into:

* visual analytics
* filters
* charts
* comparisons
* trends
* actionable insights

---

## PHASE 10 — REMAINING MODULES

Apply the design system to:

* products
* teams
* documents
* settings
* other existing modules

---

# 81. QA PHASE

After implementation, test the entire application.

Do NOT assume the redesign is complete because it looks good.

Test:

* navigation
* buttons
* forms
* search
* filters
* sorting
* pagination
* drawers
* modals
* dropdowns
* tabs
* charts
* CRUD
* bulk actions
* permissions
* responsive behavior
* loading
* errors
* empty states

---

# 82. INTERACTION AUDIT

Every clickable element must be tested.

Check:

```text
Can I click it?
Does it do what it says?
Does it provide feedback?
Does loading work?
Does error handling work?
Does success work?
Does keyboard navigation work?
Does it work on mobile?
```

---

# 83. VISUAL QA

Inspect every page for:

* alignment
* spacing
* inconsistent colors
* inconsistent typography
* broken icons
* overflow
* clipped text
* poor contrast
* excessive glass
* inconsistent radius
* inconsistent shadows
* purple remnants

---

# 84. PURPLE SCAN

Perform a final repository-wide search for:

```text
purple
violet
indigo
#7
#8
#6
```

Do not blindly remove legitimate unrelated values.

Inspect every match.

Verify there are no purple design tokens or UI states remaining.

---

# 85. RESPONSIVE QA

Test at minimum:

```text
1440px desktop
1280px desktop
1024px tablet
768px tablet
480px mobile
390px mobile
```

Check:

* sidebar
* topbar
* dashboard
* tables
* drawers
* forms
* charts
* modals
* navigation

---

# 86. ACCESSIBILITY QA

Check:

* keyboard navigation
* focus visibility
* contrast
* labels
* semantic controls
* dialog focus
* screen-reader labels
* reduced motion

---

# 87. PERFORMANCE QA

Check:

* frontend build
* bundle size where practical
* console errors
* unnecessary API calls
* repeated rendering
* slow tables
* chart performance

Do not leave:

```text
console.log()
```

debugging statements unless intentionally required.

---

# 88. TESTING

Run all existing:

* unit tests
* component tests
* integration tests
* frontend tests
* backend tests
* linting
* build checks

Fix regressions caused by your changes.

Do not modify tests simply to make failures disappear.

If an existing test is outdated because the UX intentionally changed, update it carefully while preserving the underlying behavior.

---

# 89. ACCEPTANCE CRITERIA

The redesign is complete only when:

### Visual

* no purple exists
* green-first design is consistent
* glassmorphism is subtle
* typography is consistent
* spacing is consistent
* cards are polished
* tables are readable
* charts are professional

### UX

* important actions are obvious
* navigation is understandable
* search is easy
* filters are clear
* workflows preserve context
* forms are simple
* errors are understandable
* empty states are useful

### CRM

* leads are easy to manage
* deals are easy to manage
* pipeline is understandable
* tasks are actionable
* contacts are easy to access
* analytics are useful
* reports are visual and filterable

### Technical

* existing business logic preserved
* API contracts preserved
* authentication preserved
* permissions preserved
* no unnecessary dependencies
* build succeeds
* tests pass
* no critical console errors

### Responsive

* desktop works
* tablet works
* mobile works
* drawers adapt
* tables remain usable
* navigation remains accessible

---

# 90. IMPORTANT IMPLEMENTATION RULES

Before changing a component:

1. Understand why it exists.
2. Understand what data it consumes.
3. Understand which APIs it uses.
4. Understand which other screens depend on it.
5. Preserve behavior.
6. Improve presentation and UX.
7. Test the result.

Never replace working functionality with mock data.

Never invent backend endpoints.

Never silently remove features.

Never hide broken functionality behind the redesign.

---

# 91. IF SOMETHING IS BROKEN

Do not work around it cosmetically.

Trace the issue.

Determine:

```text
UI
↓
State
↓
API
↓
Backend
↓
Database
```

Fix the correct layer when appropriate.

If the issue is outside the scope of the redesign, document it rather than introducing a risky unrelated change.

---

# 92. COMPONENT QUALITY STANDARD

Every new reusable component should have:

* clear purpose
* predictable props
* sensible defaults
* responsive behavior
* accessible behavior
* loading state where relevant
* disabled state where relevant
* error state where relevant
* consistent design tokens

---

# 93. PRODUCT QUALITY STANDARD

The final application should feel like:

> A real enterprise product that a sales team could confidently use every day.

It should NOT feel like:

* an AI-generated dashboard
* a Dribbble concept
* a template
* a collection of pretty cards
* a generic admin panel

The interface must prioritize:

**clarity → productivity → consistency → aesthetics**

in that order.

---

# 94. SOLO PRODUCT DESIGN DECISION RULE

Whenever you encounter a design decision that is not explicitly specified, make the decision yourself using this hierarchy:

```text
1. User productivity
2. User clarity
3. Accessibility
4. Existing business logic
5. Consistency
6. Performance
7. Visual polish
8. Novelty
```

Do not ask for permission for every small design decision.

Use professional judgment.

---

# 95. DO NOT OVERLOAD THE USER

Whenever possible ask:

> Can this be made simpler?

If yes, simplify it.

A premium interface is not one with more components.

It is one where the user rarely has to think about the interface.

---

# 96. FINAL PRODUCT EXPERIENCE

The ideal experience is:

```text
LOGIN
  ↓
DASHBOARD
  ↓
"Here's what is happening."
  ↓
"Here's what needs attention."
  ↓
"Here's what I should do."
  ↓
ONE CLICK
  ↓
ACTION
  ↓
FEEDBACK
  ↓
DONE
```

Minimize:

```text
click
→ page
→ search
→ filter
→ open
→ edit
→ save
→ back
→ find where I was
```

Prefer:

```text
click
→ contextual action
→ done
```

---

# 97. FINAL COMMAND TO THE IMPLEMENTATION AGENT

Now begin.

Do not immediately start editing random files.

First:

1. Inspect the entire repository structure.
2. Identify the current frontend architecture.
3. Identify all CRM screens.
4. Identify reusable components.
5. Identify styling architecture.
6. Identify API/state architecture.
7. Identify existing tests.
8. Audit the current UI/UX.
9. Create a concise implementation plan.
10. Then implement the redesign phase by phase.

While implementing:

* preserve business logic
* preserve API contracts
* preserve permissions
* preserve existing workflows
* reuse existing infrastructure
* create reusable UI primitives
* avoid duplication
* avoid unnecessary dependencies
* avoid fake data
* avoid speculative functionality

After implementation:

1. Run tests.
2. Run the production build.
3. Run linting.
4. Perform responsive QA.
5. Perform accessibility QA.
6. Perform interaction QA.
7. Perform visual QA.
8. Search for purple remnants.
9. Fix all issues introduced by the redesign.
10. Review the entire application as if you were a first-time sales user.

---

# 98. REQUIRED FINAL REPORT

When finished, provide a concise but complete implementation report containing:

## Summary

What was redesigned.

## Design System

What tokens/components were created.

## Screens Updated

List every screen changed.

## UX Improvements

List the most important workflow improvements.

## New Interactions

Search, filters, drawers, keyboard shortcuts, etc.

## Responsive Improvements

Desktop/tablet/mobile changes.

## Accessibility

What was improved.

## Performance

What was checked or optimized.

## Testing

Show:

```text
Build: PASS/FAIL
Tests: PASS/FAIL
Lint: PASS/FAIL
Responsive QA: PASS/FAIL
Accessibility QA: PASS/FAIL
Purple Scan: PASS/FAIL
```

## Known Issues

Clearly list anything that could not be fixed.

Do not claim something passed if it was not actually tested.

---

# FINAL DESIGN PRINCIPLE

Build QORVEXA as a **product**, not a screenshot.

The goal is not:

> "Make the dashboard look beautiful."

The goal is:

> **"Make sales teams faster, make business information easier to understand, and make every important action feel obvious."**

The final interface should be:

**Premium.
Green-first.
Subtly glassy.
Data-driven.
Fast.
Accessible.
Consistent.
Responsive.
Action-oriented.
Enterprise-ready.**

And absolutely:

# NO PURPLE.
