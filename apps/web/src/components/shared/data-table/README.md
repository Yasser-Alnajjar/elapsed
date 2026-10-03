# Tables, filters and pagination

Every table in the app is built from the pieces in this folder plus the
`Table*` primitives in `components/ui/table.tsx`. Do not write a raw
`<table>`, a one-off filter bar or a new pager — compose these.

```
DataTableCard                 the one container (border, radius, bg-card)
├─ DataTableToolbar           search · selects · reset · actions · chips · active filters
├─ Table / TableHeader / …    the table (scrolls sideways inside the card)
│  └─ DataTableEmpty(Row)     nothing yet / nothing matches
└─ DataTablePagination        range · rows per page · numbered pages · prev/next
   DataTableCursorPagination  the same footer for cursor-paged lists
   DataTableFooter            the same strip, without a pager (count only)
```

`DataTable` is the TanStack-driven version (sortable headers, column picker,
row selection) for uniform rows described by column definitions. A table of
bespoke composite rows composes the same pieces by hand and looks identical.

## Conventions

- Headers: 40px, uppercase mono caption. Cells: `px-4 py-3`.
- Numbers, money and the actions column are right-aligned (`align="end"`).
- Content wraps; ids/timestamps use `nowrap`; one-line text uses `truncate` + `title`.
- Wide tables set a `min-w-*` and scroll inside the card; the page never scrolls sideways.
- Row actions are `Button` (`outline`/`ghost`, `size="sm"` or `icon-xs`).
- Sorting by column: `DataTableColumnHeader` (click cycles asc → desc → off).
  Ranked sorts that are not a column ("Delinquency severity") are a `DataTableSelect` with `prefix="Sort by:"`.
- Dropdown filters: `DataTableSelect`; the first option is "all" and clears the filter.
  Filters worth seeing at a glance, with counts: `DataTableFilterChips`.
- Show `onReset` on the toolbar only while a filter is active.
- Page sizes: 10 / 25 / 50 / 100.

## Where state lives

- Rows come from the server → `useUrlTableState` (filters, search, page and page size in the
  URL; any filter change returns to page 1; search is debounced 300 ms; `pending` while the
  navigation is in flight → pass it as `loading`).
- All rows already in memory → keep the controls in `useState`, page with `useClientPagination`
  and call `resetPage()` when a control changes.
