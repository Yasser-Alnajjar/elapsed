-- N9.8 (plan 09, 9.2): the `custom` ticket source. Its own migration, like the
-- Linear, GitHub and Intercom values, so the enum change commits on its own.
ALTER TYPE "IntegrationProvider" ADD VALUE 'custom';
