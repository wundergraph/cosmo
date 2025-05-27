---
title: "@edfs__hydrateSubscription"
author: Alessandro Pagnin
---

Upon initiation of an event driven federated subscripton, the router currently has to wait to receive a message from the message broker before any data at all would be returned.
Users of EDFS have requested that the subscription serves a starting state prior to the first message being received.

The current constraints of an Event Driven Graph is that each root field must return a named type that is one of three things:
1. an Entity defined in the EDG;
2. an Interface implemented by at least one Entity defined in the EDG;
3. an Union (to check) whose members are all Entities defined in the EDG.

Because we are always returning Entities, we are guaranteed primary keys defined on those Entities.

Consequently, as long as the value(s) of the key(s) are provided we can make one or more Entity representation calls to resolve the requested data.

That requested data can be sent to the client prior to the delivery of the first event from the message broker.

# @edfs__hydrateSubscription

## Potential other names

- @edfs__initialState
- @edfs__prefetch
- @edfs__initialResolve
- @edfs__preload

```graphql
directive @edfs__hydrateSubscription on ARGUMENT
```

This directive would rely on an argument supplying the necessary data to resolve the Entity.

The argument should be an Input Object that is guaranteed to define two Input fields:
1. `typeName`, which represents the `__typename` of the Entity being returned;
2. `key`, which represents the structure of the Entity key.

The input can also include an arbitrary number of other Input Fields as long as it defines the fields `key` and `typeName`.

## Composition validation

Check that the key structure matches at least one key of any Entity that could be returned by the rootField.
Composition should fail if any keys don't match.

If the argument is a list type, validate that the return type of the root field is also a list.

## Runtime validations

If the root field returns an abstract type, the typeName must reference an object that implements (interface) or is a member of (union) that abstract type in the EDG.

## Potential runtime issues

If the value of the key is invalid the entity representation call will return Null.
However constraints of the EDG dictate the return type of a root field must be non-nullable.
This could potentially close the subscription.

# Examples

## Single key, single entity returned

This is the simplest example, where we have an input that refers to an Entity with a single key field. That same input is also used for the subjects argument.

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeeUpdated(input: EmployeeInput! @edfs__hydrateSubscription): Employee! @edfs__natsSubscribe(subjects: ["employeeUpdated.{{ args.input.key }}"]) 
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}

input EmployeeInput {
    typeName: String! # The typename is necessary because of abstract types
    key: Int!
}
```


## Single key, multiple entities returned

In this example we are returning more than one entity, and so the input is a list of `EmployeeInput`.

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeesUpdated(input: [EmployeeInput]! @edfs__hydrateSubscription): [Employee!] @edfs__natsSubscribe(subjects: ["employeesUpdated"]) 
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}

input EmployeeInput {
    typeName: String! # The typename is necessary because of abstract types
    key: Int!
}
```

## Composite key, single entity returned

In this example the Entity needs a Composite Key, and an Input type is created to replicate the key structure.

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeeUpdated(input: EmployeeInput! @edfs__hydrateSubscription): Employee! @edfs__natsSubscribe(subjects: ["employeeUpdated.{{ args.input.key.id }}_{{ args.input.key.object.id }}"]) 
}

type Employee @key(fields: "id object { id }", resolvable: false){
    id: Int! @external
    object: Object! @external
}

type Object {
    id: Int! @external
}

input EmployeeInput {
    typeName: String! # The typename is necessary because of abstract types
    key: EmployeeKey!
}

input EmployeeKey {
    id: Int!
    object: ObjectKey!
}

input ObjectKey {
    id: Int!
}
```

## Single key, additional input fields


In this example, we show that arbitrary fields can be added to the input type, and used in the subjects argument.

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeeUpdated(input: [EmployeeInput]! @edfs__hydrateSubscription): Employee! @edfs__natsSubscribe(subjects: ["employeeUpdated.{{ args.input.arbitrary }}"]) 
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}

input EmployeeInput {
    typeName: String! # The typename is necessary because of abstract types
    key: Int!
    arbitrary: String!
}
```

## Single key, interface returned

In this example we show how we can propagate an inital payload where the return type of the subscription is an abstract type. 

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeeUpdated(input: EmployeeInput! @edfs__hydrateSubscription): Interface! @edfs__natsSubscribe(subjects: ["employeeUpdated.{{ args.input.key.id }}_{{ args.input.key.object.id }}"]) 
}

interface Interface {
    id: Int!
}

type EmployeeA implements Interface @key(fields: "id", resolvable: false){
  id: Int! @external
}

type EmployeeB implements Interface @key(fields: "id", resolvable: false){
  id: Int! @external
}

input EmployeeInput {
    typeName: String!
    key: Int!
}
```

## Single key, multiple interfaces returned

In this example we show how we can propagate an inital payload where the return type of the subscription is a list of abstract type and, an additional input can be used to specify the subject argument.

```graphql
directive @edfs__hydrateSubscription on ARGUMENT

type Subscription {
    employeeUpdated(input: [EmployeeInput!]! @edfs__hydrateSubscription, subject: String): [Interface!]! @edfs__natsSubscribe(subjects: ["employeeUpdated.{{ args.subject }}"]) 
}

interface Interface {
    id: Int!
}

type EmployeeA implements Interface @key(fields: "id", resolvable: false){
  id: Int! @external
}

type EmployeeB implements Interface @key(fields: "id", resolvable: false){
  id: Int! @external
}

input EmployeeInput {
    typeName: String!
    key: Int!
}
```
