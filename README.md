# React Class2Function

A Typescript script that assists you with the tedious task of converting your React class components to functional components.

## Why do this?

As the world of React evolves, better practices to reduce the code footprint and share code are encouraged to be used in our codebase. With the arrival of [functional components in React 16.7](https://legacy.reactjs.org/blog/2018/12/19/react-v-16-7.html), and [the support for hooks and functional components in React 16.8](https://legacy.reactjs.org/blog/2019/02/06/react-v16.8.0.html), the way to develop components in React changed, bringing a new set of benefits that led many to start migrating their old components to the new standards; to mention some, code readability, maintenance and refactor and easier organization of code.

To take full advantage of newer versions of React (specially with [React 18 adding state batching for better performance](https://react.dev/blog/2022/03/08/react-18-upgrade-guide) being an issue with class components), this scripts helps with the (sometimes) titanic task of migrating components.

## What is involved in the migration?

In order to migrate the class to functional components, you need to:

1. Use a function rather than a class.
2. Eliminate the constructor.
3. Preserve the `return` content and delete the `render()` method.
4. Refactor all methods to use `const` notation.
5. Delete all occurrences of `this` and `this.state` in the component.
6. Use `useState` to set the starting state(s).
7. Use `useEffect()` instead of `componentDidMount`, `componentDidUpdate` and `componentWillUnmount`.
8. `this.setState` needs to replace its content with new state setters (and effects if there's has a callback after setting the state).
9. If third-party libraries are using High Order Components (HOC) within the component, and they support hooks, replace the HOC to use hooks.

However, this script has its limitations, discussed [below](#limitations).

## Prerequisites

Make sure you are using **Node 16+**

Install the necessary libraries using

```shell
npm i
```

## How to run?

Simply use the following command:

```shell
npm run convert -- -t [FILE OR DIRECTORY TO CONVERT]
```

If you want to just grab the replaced content and save it somewhere else, or use it for your own purposes, execute:

```shell
npm run convert -- -t [FILE OR DIRECTORY TO CONVERT] --only-content
```

## Limitations

### Conversion of other lifecycle steps omitted

The script does NOT migrate special lifecycle steps, such as:

- `static getDerivedStateFromProps`
- `shouldComponentUpdate`
- `getSnapshotBeforeUpdate`

since they are rarely used and it will be better for the developers to migrate them manually once the script has taken shape; mostly, because, if many conditions are satisfied, they may not be required at all. But that's a call to be made by developers.

### `this.setState` migration not being considered

This script addresses most of the points discussed in the [migration steps listed above](#what-is-involved-in-the-migration); however, the most problematic step to deal with is the conversion of `this.setState` to new state setters. The main reason is because there are so many variations on how this could happen (including the use of [Immer's `produce`](https://immerjs.github.io/immer/example-setstate/)) and it will be impossible for the script to figure out the correct way to refactor this.

With that being said, the script will only append a note to review each effect and `setState` call so you can determine the best path of action.
