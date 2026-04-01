import { describe, expect, test } from 'vitest';
import {
  generateResolvabilityErrorReasons,
  generateSelectionSetSegments,
  type GraphFieldData,
  newRootFieldData,
  parse,
  QUERY,
  renderSelectionSet,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  type UnresolvableFieldData,
  unresolvablePathError,
} from '../../src';
import { federateSubgraphsFailure } from '../utils/utils';

describe('Field resolvability error tests', () => {
  test('that the error message for deeply nested unresolvable fields is truncated', () => {
    const fieldPath = 'query.query.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.w';
    const rootFieldData = newRootFieldData(QUERY, 'query', new Set<string>(['subgraph-a']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-b']),
      typeName: 'W',
    };
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that a custom selection limit is respected successfully', () => {
    const fieldPath = 'query.query.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.w.x.y.z.aa.bb.cc.dd.ee';
    const { outputStart, outputEnd, pathNodes } = generateSelectionSetSegments(fieldPath, 1);
    const render = renderSelectionSet({ outputStart, outputEnd, pathNodes }, {
      isLeaf: true,
      name: 'id',
    } as GraphFieldData);

    expect(pathNodes.length).toBe(2);
    expect(render).toBe(` query {
  ... # and 30 truncated selections
  ee {
   id <--
  }
 }
`);
  });

  test('that all selections are rendered when limit is negative', () => {
    const fieldPath = 'query.query.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.w.x.y.z.aa.bb.cc.dd.ee';
    const { outputStart, outputEnd, pathNodes } = generateSelectionSetSegments(fieldPath, -1);
    const render = renderSelectionSet({ outputStart, outputEnd, pathNodes }, {
      isLeaf: true,
      name: 'id',
    } as GraphFieldData);

    expect(pathNodes.length).toBe(32);
    expect(render).toBe(` query {
  query {
   a {
    b {
     c {
      d {
       e {
        f {
         g {
          h {
           i {
            j {
             k {
              l {
               m {
                n {
                 o {
                  p {
                   q {
                    r {
                     s {
                      t {
                       u {
                        w {
                         x {
                          y {
                           z {
                            aa {
                             bb {
                              cc {
                               dd {
                                ee {
                                 id <--
                                }
                               }
                              }
                             }
                            }
                           }
                          }
                         }
                        }
                       }
                      }
                     }
                    }
                   }
                  }
                 }
                }
               }
              }
             }
            }
           }
          }
         }
        }
       }
      }
     }
    }
   }
  }
 }
`);
  });

  test('that all selections are rendered when limit is zero', () => {
    const fieldPath = 'query.query.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.w.x.y.z.aa.bb.cc.dd.ee';
    const { outputStart, outputEnd, pathNodes } = generateSelectionSetSegments(fieldPath, 0);
    const render = renderSelectionSet({ outputStart, outputEnd, pathNodes }, {
      isLeaf: true,
      name: 'id',
    } as GraphFieldData);

    expect(pathNodes.length).toBe(32);
    expect(render).toBe(` query {
  query {
   a {
    b {
     c {
      d {
       e {
        f {
         g {
          h {
           i {
            j {
             k {
              l {
               m {
                n {
                 o {
                  p {
                   q {
                    r {
                     s {
                      t {
                       u {
                        w {
                         x {
                          y {
                           z {
                            aa {
                             bb {
                              cc {
                               dd {
                                ee {
                                 id <--
                                }
                               }
                              }
                             }
                            }
                           }
                          }
                         }
                        }
                       }
                      }
                     }
                    }
                   }
                  }
                 }
                }
               }
              }
             }
            }
           }
          }
         }
        }
       }
      }
     }
    }
   }
  }
 }
`);
  });

  test('that when the limit is greater than the number of selection, no truncation occurs', () => {
    const fieldPath = 'query.query.a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.w.x.y.z.aa.bb.cc.dd.ee';
    const { outputStart, outputEnd, pathNodes } = generateSelectionSetSegments(fieldPath, 50);
    const render = renderSelectionSet({ outputStart, outputEnd, pathNodes }, {
      isLeaf: true,
      name: 'id',
    } as GraphFieldData);

    expect(pathNodes.length).toBe(32);
    expect(render).toBe(` query {
  query {
   a {
    b {
     c {
      d {
       e {
        f {
         g {
          h {
           i {
            j {
             k {
              l {
               m {
                n {
                 o {
                  p {
                   q {
                    r {
                     s {
                      t {
                       u {
                        w {
                         x {
                          y {
                           z {
                            aa {
                             bb {
                              cc {
                               dd {
                                ee {
                                 id <--
                                }
                               }
                              }
                             }
                            }
                           }
                          }
                         }
                        }
                       }
                      }
                     }
                    }
                   }
                  }
                 }
                }
               }
              }
             }
            }
           }
          }
         }
        }
       }
      }
     }
    }
   }
  }
 }
`);
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      query: AQuery
    }
    
    type AQuery {
      a: A
    }
    
    type A {
      b: B
    }
    
    type B {
      c: C
    }
    
    type C {
      d: D
    }
    
    type D {
      e: E
    }
    
    type E {
      f: F
    }
    
    type F {
      g: G
    }
    
    type G {
      h: H
    }
    
    type H {
      i: I
    }
    
    type I {
      j: J
    }
    
    type J {
      k: K
    }
    
    type K {
      l: L
    }
    
    type L {
      m: M
    }
    
    type M {
      n: N
    }
    
    type N {
      o: O
    }
    
    type O {
      p: P
    }
    
    type P {
      q: Q
    }
    
    type Q {
      r: R
    }
    
    type R {
      s: S
    }
    
    type S {
      t: T
    }
    
    type T {
      u: U
    }
    
    type U {
      w: W
    }
    
    type W {
      age: Int
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type W {
      name: String
    }
  `),
};
