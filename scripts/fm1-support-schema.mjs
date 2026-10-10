/** Validator for the JSON Schema vocabulary used by support.schema.json. No application execution. */
export function validateSchema(value, schema, path = '$') {
  const errors = [];
  const fail = message => errors.push(`${path}: ${message}`);
  if (schema.anyOf && !schema.anyOf.some(option => validateSchema(value, option, path).length === 0)) fail('no permitted shape matches');
  if ('const' in schema && value !== schema.const) fail(`expected ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(', ')}`);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(schema.type === 'integer' ? Number.isInteger(value) : type === schema.type)) {
    fail(`expected ${schema.type}`); return errors;
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) fail(`minimum is ${schema.minimum}`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) fail('empty string');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) fail('too few items');
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail('duplicate items');
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)));
  } else if (type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) errors.push(...validateSchema(item, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) fail(`unexpected field ${key}`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validateSchema(item, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return errors;
}
