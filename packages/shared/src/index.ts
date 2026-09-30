/** API 响应通用结构 */
export interface ApiResponse<T = unknown> {
    code: number;
    message: string;
    data?: T;
}

/** Health 接口响应 */
export interface HealthResponse {
    status: string;
    timestamp: string;
}

/** Hello 接口响应 */
export interface HelloResponse {
    message: string;
}
