import type {
  InjectableOptions,
  InjectionExpression,
  InjectionToken,
  InjectOptions,
} from "./common.ts";

export interface InjectableMetadata extends InjectableOptions {
  /**
   * Random generated during decoration.
   */
  id: string;
}

export interface InjectionDependency {
  field: string | symbol;
  token: InjectionToken;
  options?: InjectOptions;
  expression?: InjectionExpression;
}
