export interface QubuAdapter<T = any> {
  connect(client: T): Promise<any>
  close(client: T): Promise<any>
  query(client: T, sql: string, params: any[]): Promise<any>
}
