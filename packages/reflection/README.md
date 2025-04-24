<p align="center">
  <img src="https://i.imgur.com/WgL4sfr.png" width="128" alt="Deno Matrix Logo" />
</p>

<p align="center">
  Lightweight implementation of <a href="https://github.com/rbuckton/reflect-metadata/">reflect-metadata</a> to work with <a href="https://github.com/tc39/proposal-decorators/">Stage 2 ECMAScript decorators</a>, based on <a href="https://github.com/abraham/reflection/">@abraham/reflection</a> but with slight changes to make it usable in Deno.
</p>

<p align="center">
  <a href="https://jsr.io/@denorid"><img alt="JSR" src="https://jsr.io/badges/@denorid" /></a>
  <a href="https://discord.gg/uytbwfPHZy" target="_blank"><img alt="Discord" src="https://img.shields.io/discord/1313255221941633044?logo=discord&label=Discord&color=7289DA"></a>
</p>

## Why

The actual two reasons for this were:

1. The official `reflect-metadata` package is quite large
2. Both the official package and the implementation of @abraham were published on npm

According to this, the following was done:

- Ported [@abraham/reflection](https://github.com/abraham/reflection) and made a few changes, so that it complies with Deno
- The error messages have been improved
- Wrappers for `design:paramtypes`, `design:returntype`, `design:type`. Every method accepts the class constructor or instantiated class
  - `getParamTypes()`
  - `getReturnType()`
  - `getPropType()`
- Proper JSDoc for JSR ❤️
- New type: `GenericClassDecorator` which should be used instead of the ECMAScript `ClassDecorator` type because the `Function` type is softly banned

```diff
- function OldClassDecorator(): ClassDecorator {
-   return <T extends Function>(target: T): T | void => {}
+ function NewClassDecorator(): GenericClassDecorator {
+   return <T>(target: Constructor<T>): Constructor<T> | void => {}
}
```

## Usage

> [!IMPORTANT]
> To be able to work with decorators and metadata, the `experimentalDecorators`
> option is required in the `compilerOptions`.
> [Stage 3 decorators](https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators)
> have been available since TypeScript 5.0, but bring new limitations with them.

```ts
import { Reflection } from "@denorid/reflection";

// You must decorate a class / property / method when you want to use the built-in metadata keys,
// such as "design:paramtypes" or "design:returntype". So this decorator does nothing else than
// tricking the TypeScript compiler.
function ExampleDecorator():
  & ClassDecorator
  & MethodDecorator
  & ParameterDecorator
  & PropertyDecorator {
  const fn = (): void => {};

  return fn as unknown as
    & ClassDecorator
    & MethodDecorator
    & ParameterDecorator
    & PropertyDecorator;
}

@ExampleDecorator()
class Foo {
  @ExampleDecorator()
  public occurred: Date = new Date();

  @ExampleDecorator()
  public problematicTypeReflection = new Date();

  @ExampleDecorator()
  public greet(name: string): string {
    return `Hello, ${name}, it's ${this.occurred.toTimeString()}`;
  }
}

@ExampleDecorator()
class Example {
  public constructor(
    public readonly a: string,
    public readonly b: number,
    public readonly foo: Foo,
  ) {}
}

console.log(Reflection.getParamTypes(Example));
// "[ [Function: String], [Function: Number], [class Foo] ]"

console.log(Reflection.getReturnType(Foo, "greet"));
// "[Function: String]"

console.log(Reflection.getParamTypes(Foo, "greet"));
// "[ [Function: String] ]"

console.log(Reflection.getPropType(Foo, "occurred"));
// "[Function: Date]"

console.log(Reflection.getPropType(Foo, "problematicTypeReflection"));
// "undefined" => because `problematicTypeReflection` infers the type from assignment
// which is a problem for the reflection API.
```

## License

The [@denorid/reflection](https://github.com/neonbyte1/denorid) repository is
[MIT licensed](../../LICENSE.md).
