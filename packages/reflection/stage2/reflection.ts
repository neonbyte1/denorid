import type { Constructor } from "../common_types.ts";
import { decorate } from "./decorate.ts";
import {
  defineMetadata,
  getMetadata,
  getOwnMetadata,
  hasMetadata,
  hasOwnMetadata,
  metadata,
} from "./metadata.ts";

function getMetadataFromTarget<T, Target>(
  key: string,
  target: Constructor<Target> | Target,
  propertyKey?: string,
): T | undefined {
  /** @var {Constructor} targetOrPrototype */
  const targetOrPrototype = typeof propertyKey === "string"
    ? (typeof target === "function" ? target.prototype : target)
    : target;

  return getMetadata<T>(
    key,
    targetOrPrototype,
    propertyKey,
  );
}

function getParamTypes<T>(
  target: Constructor<T>,
  propertyKey?: string,
): Constructor[];
function getParamTypes<T extends object>(
  target: T,
  propertyKey: string,
): Constructor[];
function getParamTypes<T>(
  target: Constructor<T> | T,
  propertyKey?: string,
): Constructor[] {
  return getMetadataFromTarget<Constructor[], T>(
    "design:paramtypes",
    target,
    propertyKey,
  ) ?? [];
}

function getReturnType<T>(
  target: Constructor<T>,
  propertyKey: string,
): Constructor | undefined;
function getReturnType<T extends object>(
  target: T,
  propertyKey: string,
): Constructor | undefined;
function getReturnType<T>(
  target: Constructor<T> | T,
  propertyKey: string,
): Constructor | undefined {
  return getMetadataFromTarget(
    "design:returntype",
    target,
    propertyKey,
  );
}

function getPropType<T>(
  target: Constructor<T>,
  propertyKey: string,
): Constructor | undefined;
function getPropType<T extends object>(
  target: T,
  propertyKey: string,
): Constructor | undefined;
function getPropType<T>(
  target: Constructor<T> | T,
  propertyKey: string,
): Constructor | undefined {
  return getMetadataFromTarget<Constructor, T>(
    "design:type",
    target,
    propertyKey,
  );
}

export const Reflection = {
  decorate,
  defineMetadata,
  getMetadata,
  getOwnMetadata,
  hasMetadata,
  hasOwnMetadata,
  metadata,
  getParamTypes,
  getReturnType,
  getPropType,
};
