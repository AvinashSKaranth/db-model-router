// TypeScript Type Definitions for db-model-router

export interface RouterLike {
  use(...args: any[]): this;
  get(...args: any[]): this;
  post(...args: any[]): this;
  put(...args: any[]): this;
  patch(...args: any[]): this;
  delete(...args: any[]): this;
  all(...args: any[]): this;
  [key: string]: any;
}

export interface ModelHooks<T = any> {
  beforeSave?: (data: Partial<T>, context?: any) => Promise<Partial<T> | void> | Partial<T> | void;
  afterSave?: (data: T, context?: any) => Promise<T | void> | T | void;
  beforeCreate?: (data: Partial<T>, context?: any) => Promise<Partial<T> | void> | Partial<T> | void;
  afterCreate?: (data: T, context?: any) => Promise<T | void> | T | void;
  beforeUpdate?: (data: Partial<T>, context?: any) => Promise<Partial<T> | void> | Partial<T> | void;
  afterUpdate?: (data: T, context?: any) => Promise<T | void> | T | void;
  beforeUpsert?: (data: Partial<T>, context?: any) => Promise<Partial<T> | void> | Partial<T> | void;
  afterUpsert?: (data: T, context?: any) => Promise<T | void> | T | void;
  beforeDelete?: (filter: any, context?: any) => Promise<any | void> | any | void;
  afterDelete?: (result: any, context?: any) => Promise<any | void> | any | void;
  beforeFind?: (filter: any[][][], context?: any) => Promise<any[][][] | void> | any[][][] | void;
  afterFind?: (records: T[], context?: any) => Promise<T[] | void> | T[] | void;
}

export interface ModelOptions<T = any> {
  safeDelete?: string | null;
  search_columns?: string[];
  created_at?: string | string[];
  modified_at?: string | string[];
  hooks?: ModelHooks<T>;
  [key: string]: any;
}

export interface FindResult<T = any> {
  count: number;
  data: T[];
}

export interface ByIdOptions<T = any> {
  select_columns?: (keyof T | string)[];
}

export interface ListParams<T = any> {
  page?: number | string;
  size?: number | string;
  limit?: number | string;
  sort?: string | Array<string | [string, string]>;
  search?: string;
  select_columns?: (keyof T | string)[] | string;
  [key: string]: any;
}

export interface ModelInstance<T = any> {
  insert(data: Partial<T> | { data: Partial<T>[] }, context?: any): Promise<T | { id: number | string; count?: number }>;
  update(data: Partial<T> | { data: Partial<T>[] }, context?: any): Promise<T | null | { count?: number }>;
  upsert(data: Partial<T> | { data: Partial<T>[] }, context?: any): Promise<T | null | { id?: number | string }>;
  patch(data: Partial<T> & Record<string, any>, context?: any): Promise<T | null>;
  remove(data: Partial<T> | any[], context?: any): Promise<{ count?: number; [key: string]: any }>;
  byId(id: string | number, options?: ByIdOptions<T>, context?: any): Promise<T | null>;
  find(data?: Record<string, any>, context?: any): Promise<FindResult<T>>;
  findOne(data?: Record<string, any>, context?: any): Promise<T | false>;
  list(data?: ListParams<T>, context?: any): Promise<FindResult<T>>;
  pk: string;
  table: string;
  modelStructure: Record<string, string>;
  hooks: ModelHooks<T>;
}

export interface DatabaseAdapter {
  connect(config: any): Promise<any> | any;
  disconnect(): Promise<any> | any;
  get(table: string, filter?: any[][][], sort?: any[], safeDelete?: string | null): Promise<FindResult<any>>;
  list(table: string, filter?: any[][][], sort?: any[], safeDelete?: string | null, page?: number, size?: number): Promise<FindResult<any>>;
  insert(table: string, data: any, unique?: any[]): Promise<any>;
  upsert(table: string, data: any, unique?: any[]): Promise<any>;
  remove(table: string, filter?: any[][][], safeDelete?: string | null): Promise<any>;
  query(sql: string, params?: any[]): Promise<any>;
  escapeId(name: string): string;
  [key: string]: any;
}

export function model<T = any>(
  dbOrTable: DatabaseAdapter | string,
  tableOrStructure?: string | Record<string, string>,
  modelStructureOrPK?: Record<string, string> | string,
  primary_keyOrUnique?: string | string[] | string[][],
  uniqueOrOption?: string[] | string[][] | ModelOptions<T>,
  optionOrUndefined?: ModelOptions<T>
): ModelInstance<T>;

export function route(
  model: ModelInstance<any>,
  override?: Record<string, any>
): RouterLike;

export const db: DatabaseAdapter;

export function init(
  adapter: string,
  config?: any
): DatabaseAdapter;

export default {
  model,
  route,
  db,
  init,
};
