/**
 * React 19 removed the ambient global `JSX` namespace (it moved to
 * `React.JSX`). Components annotate their return type as `JSX.Element`;
 * restore the global alias rather than importing React into every file for
 * the sake of one type. Same shim as Code Monet's.
 */
import type * as React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementType = React.JSX.ElementType
    interface ElementClass extends React.JSX.ElementClass {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
  }
}

export {}
