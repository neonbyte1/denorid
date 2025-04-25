/**
 * @module
 *
 * @example
 * ```ts ignore
 * import { Reflection } from "@denorid/reflection";
 *
 * // You must decorate a class / property / method when you want to use the built-in metadata keys,
 * // such as "design:paramtypes" or "design:returntype". So this decorator does nothing else than
 * // tricking the TypeScript compiler.
 * function ExampleDecorator():
 *   & ClassDecorator
 *   & MethodDecorator
 *   & ParameterDecorator
 *   & PropertyDecorator {
 *   const fn = (): void => {};
 *
 *   return fn as unknown as
 *     & ClassDecorator
 *     & MethodDecorator
 *     & ParameterDecorator
 *     & PropertyDecorator;
 * }
 *
 * @ExampleDecorator()
 * class Foo {
 *   @ExampleDecorator()
 *   public occurred: Date = new Date();
 *
 *   @ExampleDecorator()
 *   public problematicTypeReflection = new Date();
 *
 *   @ExampleDecorator()
 *   public greet(name: string): string {
 *     return `Hello, ${name}, it's ${this.occurred.toTimeString()}`;
 *   }
 * }
 *
 * @ExampleDecorator()
 * class Example {
 *   public constructor(
 *     public readonly a: string,
 *     public readonly b: number,
 *     public readonly foo: Foo,
 *   ) {}
 * }
 *
 * console.log(Reflection.getParamTypes(Example));
 * // "[ [Function: String], [Function: Number], [class Foo] ]"
 *
 * console.log(Reflection.getReturnType(Foo, "greet"));
 * // "[Function: String]"
 *
 * console.log(Reflection.getParamTypes(Foo, "greet"));
 * // "[ [Function: String] ]"
 *
 * console.log(Reflection.getPropType(Foo, "occurred"));
 * // "[Function: Date]"
 *
 * console.log(Reflection.getPropType(Foo, "problematicTypeReflection"));
 * // "undefined" => because `problematicTypeReflection` infers the type from assignment
 * // which is a problem for the reflection API.
 * ```
 */
export * from "./common_types.ts";
export * from "./stage2/mod.ts";
