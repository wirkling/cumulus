import type { Customer } from '@cumulus/shared-types';
import { getSql } from '../client.js';
import { mapCustomer } from '../mappers.js';

export async function createCustomer(params: {
  name: string;
  apiKeyHash: string;
  keyPrefix: string;
}): Promise<Customer> {
  const sql = getSql();
  const rows = await sql`
    insert into customers (name, api_key_hash, key_prefix)
    values (${params.name}, ${params.apiKeyHash}, ${params.keyPrefix})
    returning *`;
  return mapCustomer(rows[0]!);
}

/** Resolve a presented API key (by its hash) to an active customer, or null. */
export async function findCustomerByKeyHash(apiKeyHash: string): Promise<Customer | null> {
  const sql = getSql();
  const rows = await sql`
    select * from customers where api_key_hash = ${apiKeyHash} and status = 'active' limit 1`;
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function listCustomers(): Promise<Customer[]> {
  const sql = getSql();
  const rows = await sql`select * from customers order by created_at desc`;
  return rows.map(mapCustomer);
}
