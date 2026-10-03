"use client";

import { useTransition } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";

/**
 * Utility to work with query parameters in Next.js.
 * Provides methods to get an object from query parameters
 * and create a query string from an object.
 */
export const useQueryParams = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathName = usePathname();
  // Navigations run in a transition so callers can tell a fetch is in flight
  // (`isPending`) and dim the table instead of leaving it looking stale.
  const [isPending, startTransition] = useTransition();
  const push = (href: string) =>
    startTransition(() => router.push(href, { scroll: false }));

  /**
   * Retrieves query parameters as an object.
   * @returns {Object} The query parameters as a key-value object.
   */
  const getQueryObject = () => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    const queryObject: Record<string, any> = {};

    params.forEach((value, key) => {
      if (value === "true") {
        queryObject[key] = true;
      } else if (value === "false") {
        queryObject[key] = false;
      } else if (!isNaN(Number(value))) {
        queryObject[key] = Number(value);
      } else {
        queryObject[key] = value;
      }
    });

    return queryObject;
  };
  /**
   * Creates a query string from an object and updates the URL.
   * @param {Object} queryObject - The object to convert to a query string.
   */
  const createQueryFromObject = (
    queryObject: Record<string, any>,
    pathName?: string,
  ) => {
    // Initialize with existing query parameters
    const params = new URLSearchParams(searchParams?.toString());

    // Update or add new parameters from the provided object
    Object.entries(queryObject).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value.toString() !== "") {
        params.set(key, value.toString());
      } else {
        // Remove the parameter if the value is null or undefined
        params.delete(key);
      }
    });

    // Convert to string and update the URL
    if (pathName) {
      const queryString = params.toString();
      push(`${pathName}?${queryString}`);
    } else {
      const queryString = params.toString();
      push(`?${queryString}`);
    }
  };

  /**
   * Modifies the query parameters in the URL.
   * If a key is provided, it removes that specific query parameter.
   * If no key is provided, it clears all query parameters.
   * Updates the URL with the modified query parameters without scrolling.
   *
   * @param {string | Array<string>} [key] - The specific key(s) of the query parameter to remove. If not provided, all query parameters are removed.
   */
  const modifyQueryParams = (key?: string | Array<string>) => {
    const params = new URLSearchParams(searchParams?.toString());
    const currentPath = pathName;

    if (key) {
      // Remove specific key(s)
      const keys = Array.isArray(key) ? key : [key];
      keys.forEach((k) => params.delete(k));

      const newQueryString = params.toString();

      push(newQueryString ? `${currentPath}?${newQueryString}` : currentPath);
    } else {
      // Clear all query parameters
      push(currentPath);
    }
  };

  const clearAll = () => {
    push(`${pathName}`);
  };

  const updatePaginationQuery = ({
    page,
    pageSize,
  }: {
    pageSize?: string;
    page?: string;
  }) => {
    const params = new URLSearchParams(searchParams?.toString());

    // Get current values or set defaults
    const currentPageSize = pageSize ?? (Number(params.get("pageSize")) || 10);
    const currentPage = page ?? (Number(params.get("page")) || 1);

    // Calculate new values
    const skip = (Number(currentPage) - 1) * Number(currentPageSize);
    const take = currentPageSize;

    // Update parameters
    params.set("pageSize", currentPageSize.toString());
    params.set("skip", skip.toString());
    params.set("take", take.toString());

    // Push updated query to the router
    push(`?${params.toString()}`);
  };

  return {
    getQueryObject,
    createQueryFromObject,
    modifyQueryParams,
    updatePaginationQuery,
    clearAll,
    isPending,
  };
};
