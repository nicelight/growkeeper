/** A bounded JSON Schema subset for this application's static tool schemas, not a general validator. */
import {AppError} from './lib.js';
export const S = {
  string: (maxLength=2000, extra={}) => ({type:'string',minLength:1,maxLength,...extra}),
  boolean: {type:'boolean'},
  number: (minimum=0,maximum=1) => ({type:'number',minimum,maximum}),
  integer: (minimum=0,maximum=1000000) => ({type:'integer',minimum,maximum}),
  enum: (...values) => ({type:'string',enum:values}),
  array: (items,maxItems=20) => ({type:'array',items,maxItems}),
  object: (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false}),
  uuid: {type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},
  date: {type:'string',format:'date-time',maxLength:40},
};
export function validate(schema, value, path='arguments') {
  const bad=(message)=>{throw new AppError('VALIDATION',`${path}: ${message}`,400);};
  if (schema.enum && !schema.enum.includes(value)) bad(`expected one of ${schema.enum.join(', ')}`);
  switch(schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) bad('expected object');
      for (const k of schema.required || []) if (!Object.hasOwn(value,k)) bad(`missing ${k}`);
      for (const [k,v] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties||{},k)) {if(schema.additionalProperties===false) bad(`unexpected field ${k}`);}
        else validate(schema.properties[k],v,`${path}.${k}`);
      } break;
    }
    case 'array':
      if (!Array.isArray(value)) bad('expected array');
      if (value.length > (schema.maxItems ?? 100)) bad('too many items');
      if (value.length < (schema.minItems ?? 0)) bad('not enough items');
      value.forEach((x,i)=>validate(schema.items,x,`${path}[${i}]`)); break;
    case 'string':
      if (typeof value !== 'string') bad('expected string');
      if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 100000)) bad('invalid string length');
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) bad('invalid format');
      if (schema.format === 'date-time' && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) bad('expected ISO date with timezone');
      break;
    case 'number': case 'integer':
      if (typeof value!=='number'||!Number.isFinite(value)) bad('expected finite number');
      if (schema.type==='integer'&&!Number.isSafeInteger(value)) bad('expected integer');
      if (value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)) bad('out of range'); break;
    case 'boolean': if(typeof value!=='boolean') bad('expected boolean'); break;
    default: if (schema.type) bad('unsupported schema type');
  }
  return value;
}
