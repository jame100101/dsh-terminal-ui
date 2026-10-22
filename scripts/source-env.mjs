/** Set the renderer mode before loading React, without resetting profile secrets. */
export function sourceChildEnv(environment, home) {
  return { ...environment, NODE_ENV: 'production', DSH_HOME: home }
}
