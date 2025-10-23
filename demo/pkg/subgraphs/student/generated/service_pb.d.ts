// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as jspb from "google-protobuf";

export class QueryHelloRequest extends jspb.Message { 
    getName(): string;
    setName(value: string): QueryHelloRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryHelloRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryHelloRequest): QueryHelloRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryHelloRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryHelloRequest;
    static deserializeBinaryFromReader(message: QueryHelloRequest, reader: jspb.BinaryReader): QueryHelloRequest;
}

export namespace QueryHelloRequest {
    export type AsObject = {
        name: string,
    }
}

export class QueryHelloResponse extends jspb.Message { 

    hasHello(): boolean;
    clearHello(): void;
    getHello(): World | undefined;
    setHello(value?: World): QueryHelloResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryHelloResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryHelloResponse): QueryHelloResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryHelloResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryHelloResponse;
    static deserializeBinaryFromReader(message: QueryHelloResponse, reader: jspb.BinaryReader): QueryHelloResponse;
}

export namespace QueryHelloResponse {
    export type AsObject = {
        hello?: World.AsObject,
    }
}

export class World extends jspb.Message { 
    getId(): string;
    setId(value: string): World;
    getName(): string;
    setName(value: string): World;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): World.AsObject;
    static toObject(includeInstance: boolean, msg: World): World.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: World, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): World;
    static deserializeBinaryFromReader(message: World, reader: jspb.BinaryReader): World;
}

export namespace World {
    export type AsObject = {
        id: string,
        name: string,
    }
}
