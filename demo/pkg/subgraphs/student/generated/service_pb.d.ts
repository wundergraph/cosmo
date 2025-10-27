// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as jspb from "google-protobuf";

export class QueryHello2Request extends jspb.Message { 
    getName(): string;
    setName(value: string): QueryHello2Request;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryHello2Request.AsObject;
    static toObject(includeInstance: boolean, msg: QueryHello2Request): QueryHello2Request.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryHello2Request, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryHello2Request;
    static deserializeBinaryFromReader(message: QueryHello2Request, reader: jspb.BinaryReader): QueryHello2Request;
}

export namespace QueryHello2Request {
    export type AsObject = {
        name: string,
    }
}

export class QueryHello2Response extends jspb.Message { 

    hasHello2(): boolean;
    clearHello2(): void;
    getHello2(): World | undefined;
    setHello2(value?: World): QueryHello2Response;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryHello2Response.AsObject;
    static toObject(includeInstance: boolean, msg: QueryHello2Response): QueryHello2Response.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryHello2Response, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryHello2Response;
    static deserializeBinaryFromReader(message: QueryHello2Response, reader: jspb.BinaryReader): QueryHello2Response;
}

export namespace QueryHello2Response {
    export type AsObject = {
        hello2?: World.AsObject,
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
