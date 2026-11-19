import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { z } from "zod/v4";
import type { DataTable } from "@/lib/openui/catalog";
import { Input } from "@/components/atoms/Input/Input";
import { useId } from "react";
import { useDataTableView } from "./useDataTableView";

export function DataTableView({
  props,
}: ComponentRenderProps<z.infer<typeof DataTable.props>>) {
  const id = useId();
  const { query, setQuery, sort, toggleSort, visibleRows } = useDataTableView(
    props.rows ?? [],
  );
  return (
    <section className="border-zinc-200 bg-white min-w-0 overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h3 className="text-sm text-zinc-800 font-semibold">{props.title}</h3>
        <Input
          id={id}
          label={`Filter ${props.title}`}
          hideLabel
          placeholder="Filter results…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
          className="!text-xs !h-8"
          wrapperClassName="w-36"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full text-left">
          <thead className="border-zinc-100 bg-zinc-50 text-zinc-500 border-y">
            <tr>
              {props.columns?.slice(0, 6).map((column, index) => (
                <th
                  key={`${index}-${column}`}
                  className="px-5 py-3 font-medium"
                  aria-sort={
                    sort.column === index
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    onClick={() => toggleSort(index)}
                    className="focus-visible:outline-purple-500 rounded-sm text-left whitespace-nowrap"
                  >
                    {column}
                    <span aria-hidden className="text-zinc-400 ml-1">
                      {sort.column === index
                        ? sort.ascending
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-zinc-100 divide-y">
            {visibleRows.map((row, index) => (
              <tr key={index} className="hover:bg-zinc-50">
                {props.columns?.slice(0, 6).map((column, cellIndex) => (
                  <td
                    key={`${cellIndex}-${column}`}
                    className="text-zinc-700 first:text-zinc-900 px-5 py-3 first:font-medium"
                  >
                    {row[cellIndex]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleRows.length && (
          <p className="text-sm text-zinc-500 p-5">
            No matching results. Try another filter.
          </p>
        )}
      </div>
    </section>
  );
}
