import { describe, expect, it } from "vitest";
import { isIntercomTrackerTicket, linkedTrackerIds } from "../src/tracker";

describe("isIntercomTrackerTicket", () => {
  it("recognizes a Tracker ticket by its built-in Ticket category attribute", () => {
    expect(isIntercomTrackerTicket({ custom_attributes: { "Ticket category": "Tracker ticket" } })).toBe(true);
  });

  it("does not take a customer ticket, a back-office ticket or a plain conversation for one", () => {
    expect(isIntercomTrackerTicket({ custom_attributes: { "Ticket category": "Customer ticket" } })).toBe(false);
    expect(isIntercomTrackerTicket({ custom_attributes: { "Ticket category": "Back-office ticket" } })).toBe(false);
    expect(isIntercomTrackerTicket({ custom_attributes: {} })).toBe(false);
    expect(isIntercomTrackerTicket({ custom_attributes: null })).toBe(false);
    expect(isIntercomTrackerTicket({})).toBe(false);
  });
});

describe("linkedTrackerIds", () => {
  // The live shape of the customer conversation 215476246219089: two trackers made from it.
  it("lists the Tracker tickets a conversation's linked_objects names", () => {
    expect(
      linkedTrackerIds({
        linked_objects: {
          data: [
            { id: "215476246230453", type: "ticket", category: "Tracker" },
            { id: 215476246247469, type: "ticket", category: "Tracker" },
          ],
        },
      }),
    ).toEqual(["215476246230453", "215476246247469"]);
  });

  it("ignores conversations, non-tracker tickets and a tracker's own reference back", () => {
    expect(
      linkedTrackerIds({
        linked_objects: {
          data: [
            { id: "1", type: "conversation", category: null },
            { id: "2", type: "ticket", category: "Customer" },
            { id: "3", type: "ticket", category: null },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("returns nothing when linked_objects is absent or malformed", () => {
    expect(linkedTrackerIds({})).toEqual([]);
    expect(linkedTrackerIds({ linked_objects: null })).toEqual([]);
    expect(linkedTrackerIds({ linked_objects: { data: null } })).toEqual([]);
    expect(linkedTrackerIds({ linked_objects: { data: "oops" as never } })).toEqual([]);
  });
});
