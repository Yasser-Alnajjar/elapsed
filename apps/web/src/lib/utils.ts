/* eslint-disable- */
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-xxs` is a custom font size from the theme; without registering it,
// twMerge treats it as a text colour and drops it next to e.g. `text-primary`.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["xxs"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A caught value's message, for logs and error responses — `throw` can throw anything, not only an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
import moment from "moment";
import { ZodError, z } from "zod";

/**
 * Returns the given `obj` without the `property`.
 *
 * @param {Object} obj
 * @param {String} property
 *
 * @returns {Object}
 */
type AnyObject = Record<string, any>;
type EnumValueType = string | number;
const withoutProperty = (obj: AnyObject, property: string) => {
  if (Object.keys(obj).find((k) => k === property)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [property]: unused, ...rest } = obj;
    return rest;
  } else return obj;
};

const decodeURIObject = <T extends AnyObject>(obj: T): T => {
  const result: any = {};

  Object.keys(obj).map((k) => {
    result[k] = decodeURIComponent(obj[k]);
  });

  return result as T;
};

const removeObjectKeys = <T extends AnyObject>(
  obj: T,
  keysToRemove: string[],
): T => {
  const newObj = {} as T;

  for (const key in obj) {
    if (!keysToRemove.includes(key)) {
      newObj[key] = obj[key];
    }
  }

  return newObj;
};

const removePartialPrefix = (str: string, prefix: string): string => {
  if (str.startsWith(prefix)) {
    return str.slice(prefix.length); // Removes 'partial_' from the beginning
  }
  return str; // Return the string unchanged if it doesn't start with 'partial_'
};

const loadJSON = (path: string) => {
  return fetch(`${path}.json`, {
    headers: { "Cache-Control": "no-cache" },
  }).then((res) => res.json());
};

const objToArrayOfKeyAndValue = (obj?: any): Array<any> | undefined => {
  if (!obj) return undefined;
  const results: Array<any> = [];
  Object.keys(obj).map((key) => {
    results.push({ [key]: obj[key] });
  });
  return results;
};

const convertArrayOfKeyAndValuesToString = (
  items?: Array<Record<string, unknown>>,
  separator: string = ";",
): string | undefined => {
  if (!items?.length) return undefined;

  const keyValueStrings = items
    .map((item) => {
      const objKey = Object.keys(item)[0];

      if (!objKey) return undefined;

      return `${objKey}:${item[objKey]}`;
    })
    .filter((value): value is string => value !== undefined);

  return keyValueStrings.length > 0
    ? keyValueStrings.join(separator)
    : undefined;
};
const findKeyByValue = (obj: any, value: any) =>
  (Object.keys(obj) as (keyof typeof obj)[]).find((key) => {
    return !Array.isArray(obj[key])
      ? obj[key] === value
      : !!obj[key].includes(value);
  });

const ascendingSortedData = (items: Array<any>, sortField: string) =>
  items.slice().sort((a, b) => a[sortField].localeCompare(b[sortField]));

// Sort in descending order by name
const descendingSortedData = (items: Array<any>, sortField: string) =>
  items.slice().sort((a, b) => b[sortField].localeCompare(a[sortField]));

const getObjFirstKey = (obj?: object) => Object.keys(obj as object)[0] || "";

const getType = (p: any): string => {
  if (Array.isArray(p)) return "array";
  else if (typeof p == "string") return "string";
  else if (p != null && typeof p == "object") return "object";
  else return "other";
};

const getFileExtension = (fileName: string) => {
  const regex = /\.\w{3,4}($|\?)/;
  const matchResult = fileName.match(regex);
  return matchResult?.[0] || null;
};

const toPascalCase = (input: string): string => {
  if (input) {
    // Replace hyphens and underscores with spaces
    const stringWithSpaces = input.replace(/[-_]/g, " ");

    // Split the string into words
    const words = stringWithSpaces.split(" ");

    // Capitalize the first letter of each word and join them
    const pascalCaseString = words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    return pascalCaseString;
  }
  return input;
};

const generateCode = (
  length: number,
  charsOnly = false,
  digitsOnly = false,
) => {
  let result = "";
  const characters = charsOnly
    ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    : digitsOnly
      ? "0123456789"
      : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
};

/**
 * Remove all specified keys from an object, no matter how deep they are.
 * The removal is done in place, so run it on a copy if you don't want to modify the original object.
 * This function has no limit so circular objects will probably crash the browser
 *
 * @param obj The object from where you want to remove the keys
 * @param keys An array of property names (strings) to remove
 */
const removeKeysDeep = (obj: AnyObject, keys: Array<string>) => {
  let index;
  for (const prop in obj) {
    // important check that this is objects own property
    // not from prototype prop inherited
    if (obj.hasOwnProperty(prop)) {
      switch (typeof obj[prop]) {
        case "object":
          index = keys.indexOf(prop);
          if (index > -1) {
            delete obj[prop];
          } else {
            removeKeysDeep(obj[prop], keys);
          }
          break;
        default:
          keys.forEach((k) => {
            if (k === prop) delete obj[prop];
          });
          break;
      }
    }
  }
};

const enumKeyByValue = (
  enumObj: AnyObject,
  val: string,
): string | undefined => {
  const index = Object.values(enumObj).indexOf(val);

  return index === -1 ? undefined : Object.keys(enumObj)[index];
};
const decodeJWT = (token: string) => {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
  } catch {
    return null;
  }
};

const formatDate = (
  date?: string,
  fromNow?: true,
  time: "12" | "24" = "12",
  format?: string,
): string => {
  if (!date || isNaN(new Date(date).getTime())) {
    return date || "";
  }

  const value = moment(date);

  if (format) {
    return value.format(format);
  }

  if (fromNow) {
    return value.fromNow(true);
  }

  if (time === "12") {
    return value.format("DD MMM YYYY h:mm:ss A");
  }

  if (time === "24") {
    return value.format("DD MMM YYYY HH:mm:ss");
  }

  return value.format("DD/MM/YYYY");
};

const numberWithCommas = (val?: number) => {
  return (val || 0).toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
};

const formatCash = (n: number) => {
  if (n < 1e3) return n;
  if (n >= 1e3 && n < 1e6) return +(n / 1e3).toFixed(1) + "K";
  if (n >= 1e6 && n < 1e9) return +(n / 1e6).toFixed(1) + "M";
  if (n >= 1e9 && n < 1e12) return +(n / 1e9).toFixed(1) + "B";
  if (n >= 1e12) return +(n / 1e12).toFixed(1) + "T";
  return "";
};

function getTodayDateRanges(format: string = "YYYY-MM-DD"): {
  today: { start: string; end: string };
  lastWeek: { start: string; end: string };
  thisWeek: { start: string; end: string };
  thisMonth: { start: string; end: string };
  thisYear: { start: string; end: string };
} {
  const today = moment().format(format);
  const thisWeekStart = moment().startOf("isoWeek").format(format);
  const thisWeekEnd = moment().endOf("isoWeek").format(format);
  const thisMonthStart = moment().startOf("month").format(format);
  const thisMonthEnd = moment().endOf("month").format(format);
  const thisYearStart = moment().startOf("year").format(format);
  const thisYearEnd = moment().endOf("year").format(format);
  const lastWeek = moment().subtract(6, "days").startOf("day").format(format);

  return {
    today: { start: today, end: today },
    lastWeek: { start: lastWeek, end: today },
    thisWeek: { start: thisWeekStart, end: thisWeekEnd },
    thisMonth: { start: thisMonthStart, end: thisMonthEnd },
    thisYear: { start: thisYearStart, end: thisYearEnd },
  };
}

const getMonthNumberFromName = (monthName: string): number => {
  const year = new Date().getFullYear();
  return new Date(`${monthName} 1, ${year}`).getMonth() + 1;
};

const isDate = (value: any): boolean => {
  return Object.prototype.toString.call(value) === "[object Date]";
};

const cleanEmpty = (obj: any): AnyObject => {
  if (Array.isArray(obj)) {
    return obj
      .map((v) =>
        v && typeof v === "object" && !isDate(v) ? cleanEmpty(v) : v,
      )
      .filter((v) => v !== null && v !== undefined) as AnyObject[];
  } else {
    return Object.entries(obj).reduce((acc, [k, v]) => {
      if (v !== null && v !== undefined && v !== "") {
        acc[k] = typeof v === "object" && !isDate(v) ? cleanEmpty(v) : v;
      }
      return acc;
    }, {} as AnyObject);
  }
};

const cleanEmptyArray = (arr: any[]): any[] => {
  return arr
    .map((v) =>
      v && typeof v === "object" && !isDate(v)
        ? Array.isArray(v)
          ? cleanEmptyArray(v)
          : cleanEmpty(v)
        : v,
    )
    .filter((v) => v !== null && v !== undefined && v !== "");
};

const generateQueryString = (
  params: AnyObject,
  checkNullish: boolean = true,
): string => {
  const queryString = Object.keys(params)
    .map((key) => {
      const value = params[key];

      const checkIfArray = (value: any, key: string) => {
        if (Array.isArray(value)) return `${key}=${value.join(",")}`;
        else return `${key}=${value.toString()}`;
      };

      if (checkNullish) {
        if (value !== null && value !== undefined && value.toString() !== "") {
          return checkIfArray(value, key);
        }
        return "";
      } else return checkIfArray(value, key);
    })
    .filter((param) => (checkNullish ? param !== "" : true))
    .join("&");

  return queryString ? `?${queryString}` : "";
};

const cleanEmptyAndZeros = (obj: any): AnyObject => {
  if (Array.isArray(obj)) {
    return obj
      .map((v) =>
        v && typeof v === "object" && !isDate(v) ? cleanEmpty(v) : v,
      )
      .filter(
        (v) => v !== null && v !== undefined && v.toString() !== "0",
      ) as AnyObject[];
  } else {
    return Object.entries(obj).reduce((acc, [k, v]) => {
      if (v !== null && v !== undefined && v !== "" && v.toString() !== "0") {
        acc[k] = typeof v === "object" && !isDate(v) ? cleanEmpty(v) : v;
      }
      return acc;
    }, {} as AnyObject);
  }
};

const parseZodObj = <T extends z.Schema>(schema: T, obj: object) => {
  return schema.safeParse(obj) as
    | {
        success: true;
        data: z.infer<typeof schema>;
        error?: never;
      }
    | {
        success: false;
        error: ZodError<z.infer<typeof schema>>;
        data?: never;
      };
};

const parseZodSearchParams = <T extends z.Schema>(schema: T, obj?: object) => {
  return schema.safeParse(
    decodeURIObject<object>(obj ? (obj as object) : ({} as object)),
  ) as
    | {
        success: true;
        data: z.infer<typeof schema>;
        error?: never;
      }
    | {
        success: false;
        error: ZodError<z.infer<typeof schema>>;
        data?: never;
      };
};

const sleep = (ms?: number | undefined) =>
  new Promise((r) => setTimeout(r, ms));

// Function to check array of Interface1 or Interface2
function isArrayOfType(arr: any[], typeGuard: (obj: any) => boolean): boolean {
  return arr.every(typeGuard);
}

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const compareValues = (
  source: any,
  target: any,
  operator: "sw" | "swi" | "eq" | "in" | "ini",
) => {
  switch (operator) {
    case "sw": // Start With case sensitive
      return source?.startsWith(target);
    case "swi": // Start With case insensitive
      return source?.toLowerCase().startsWith(target?.toLowerCase());
    case "eq": // Equal To
      return source === target;
    case "in": // Includes case sensitive
      return source.toString().includes(target.toString());
    case "ini": // Includes case insensitive
      return source
        .toString()
        .toLowerCase()
        .includes(target.toString().toLowerCase());
    default:
      return false;
  }
};

function areFamilyObject(childObj: any, parentObj: any): boolean;
function areFamilyObject(
  childObj: any,
  parentObj: any,
  operator: "sw" | "swi" | "eq" | "in" | "ini" = "eq",
): boolean {
  // Handle null/undefined cases
  if (!childObj || !parentObj) return false;

  if (getType(childObj) === "object" && getType(parentObj) === "object") {
    for (const key in childObj) {
      if (childObj[key] !== parentObj[key]) {
        return false;
      }
    }
  } else if (
    getType(childObj) === "string" &&
    getType(parentObj) === "string"
  ) {
    return compareValues(parentObj, childObj, operator);
  }

  return true;
}

const valueToEnum = <T extends object>(
  enumType: T,
  val: EnumValueType,
): T | undefined => {
  const enumKeys = Object.keys(enumType) as (keyof typeof enumType)[];
  const key = enumKeys.find((key) => enumType[key] === val);
  return key !== undefined ? (enumType[key] as T) : undefined;
};

function hasPropertyWithSpecificValue(
  obj: any,
  targetProp: string,
  targetValue: any,
): boolean;
function hasPropertyWithSpecificValue(
  obj: any,
  targetProp: string,
  targetValue: any,
  operator: "sw" | "swi" | "eq" | "in" | "ini",
): boolean;

function hasPropertyWithSpecificValue(
  obj: AnyObject,
  targetProp: string,
  targetValue: any,
  operator: "sw" | "swi" | "eq" | "in" | "ini" = "eq",
): boolean {
  // Check if the object is null or undefined
  if (obj === null || typeof obj !== "object") {
    return false;
  }

  if (
    obj.hasOwnProperty(targetProp) &&
    compareValues(obj[targetProp], targetValue, operator)
  ) {
    return true;
  }

  // If the object is an array, recursively search each element
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (
        hasPropertyWithSpecificValue(item, targetProp, targetValue, operator)
      ) {
        return true;
      }
    }
  } else {
    // If the object is not an array, recursively search its properties
    for (const key in obj) {
      if (
        obj.hasOwnProperty(key) &&
        typeof obj[key] === "object" &&
        hasPropertyWithSpecificValue(
          obj[key],
          targetProp,
          targetValue,
          operator,
        )
      ) {
        return true;
      }
    }
  }

  // Property with the specific value not found in the object
  return false;
}

const isFieldRequired = (field: string, validationSchema: any) => {
  const fieldSchema = validationSchema?.fields[field];
  if (!fieldSchema) return false;
  return fieldSchema.tests.some(
    (test: any) =>
      test.OPTIONS?.name === "required" || test.OPTIONS?.name === "min",
  );
};

export const getTotalFromObj = (obj: { [key: string]: any }) => {
  let total = 0;
  for (const key in obj) {
    if (typeof obj[key] === "number") total += obj[key];
  }
  return total;
};

const convertQueryParamToObject = (queryParamObject: any) => {
  const result: any = {};

  for (const [key, value] of Object.entries(queryParamObject)) {
    try {
      // Attempt to parse JSON string
      const parsedValue = JSON.parse(value as string);
      if (typeof parsedValue === "object" && parsedValue !== null) {
        result[key] = {
          key: parsedValue.key,
          value: parsedValue.value,
        };
      } else {
        result[key] = value; // Retain original value if not parsable to object
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      result[key] = value; // Retain original value if parsing fails
    }
  }

  return result;
};

const convertObjectToQueryParam = (input: any) => {
  const result: Record<string, any> = {};

  // Handle array case
  if (Array.isArray(input)) {
    for (const item of input) {
      if (
        item &&
        typeof item === "object" &&
        "key" in item &&
        "value" in item
      ) {
        result[item.key] = item.value;
      } else {
        console.warn(`Item missing "key" or "value" properties:`, item);
      }
    }
    return result;
  }

  // Handle single object case
  if (
    input &&
    typeof input === "object" &&
    "key" in input &&
    "value" in input
  ) {
    return { [input.key]: input.value };
  }

  // Handle other cases (like your original function's behavior)
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "object" && value !== null) {
      if ("key" in value && "value" in value) {
        result[value.key as any] = value.value;
      } else {
        console.warn(`Missing "key" or "value" properties in object: ${key}`);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
};

const exportToCsv = <T>(filename: string, rows: T[]) => {
  if (!rows.length) return;

  const headers = Object.keys(rows[0] as object);

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    // Escape double quotes and wrap if necessary
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent = [
    headers.join(","), // header row
    ...rows.map((row) =>
      headers.map((field) => escapeCsv(row[field as keyof T])).join(","),
    ),
  ].join("\n");

  const BOM = "\uFEFF"; // For Excel UTF-8 support
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
const exportFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
};

function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number,
): T {
  let timeoutId: NodeJS.Timeout;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  } as T;
}
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}
const removeLocaleFromUrl = (url?: string) => {
  if (!url) return "/";

  const clean = url.trim();

  // remove leading locale segment only
  const normalized = clean.replace(/^\/(en|ar)(\/|$)/i, "/");

  return normalized === "" ? "/" : normalized;
};

function formatDateTimeV2(date: Date | null | undefined): string {
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    // Pin the timezone so the server (UTC) and the browser render the SAME text.
    // Without this the times differ (UTC vs local), which triggers a React
    // hydration mismatch (#418). KSA has no DST, so Asia/Riyadh is stable and is
    // also the correct display timezone for the ministry.
    timeZone: "Asia/Riyadh",
    numberingSystem: "latn",
  }).format(new Date(date));
}

export const Utils = {
  formatDateTimeV2,
  exportFile,
  removeLocaleFromUrl,
  withoutProperty,
  loadJSON,
  objToArrayOfKeyAndValue,
  ascendingSortedData,
  descendingSortedData,
  getObjFirstKey,
  findKeyByValue,
  convertArrayOfKeyAndValuesToString,
  removeObjectKeys,
  getType,
  getFileExtension,
  toPascalCase,
  generateCode,
  removeKeysDeep,
  enumKeyByValue,
  decodeJWT,
  formatDate,
  numberWithCommas,
  formatCash,
  getTodayDateRanges,
  getMonthNumberFromName,
  generateQueryString,
  cleanEmptyAndZeros,
  cleanEmpty,
  parseZodObj,
  parseZodSearchParams,
  sleep,
  cleanEmptyArray,
  isArrayOfType,
  isDate,
  isValidUrl,
  areFamilyObject,
  compareValues,
  valueToEnum,
  hasPropertyWithSpecificValue,
  isFieldRequired,
  removePartialPrefix,
  convertQueryParamToObject,
  convertObjectToQueryParam,
  getTotalFromObj,
  exportToCsv,
  debounce,
  deepEqual,
};
