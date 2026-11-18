/**
 * 深拷贝纯数据（工程 JSON、课件数据）。
 * 不用 structuredClone：Svelte 5 的 $state 代理对象会让 structuredClone 抛 DataCloneError。
 * 工程模型只含 JSON 可序列化类型（数组、普通对象、数字、字符串、布尔），JSON 往返安全。
 */
export function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
