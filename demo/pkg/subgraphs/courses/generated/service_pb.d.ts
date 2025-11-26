// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as jspb from "google-protobuf";
import * as google_protobuf_wrappers_pb from "google-protobuf/google/protobuf/wrappers_pb";

export class LookupEmployeeByIdRequestKey extends jspb.Message { 
    getId(): string;
    setId(value: string): LookupEmployeeByIdRequestKey;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): LookupEmployeeByIdRequestKey.AsObject;
    static toObject(includeInstance: boolean, msg: LookupEmployeeByIdRequestKey): LookupEmployeeByIdRequestKey.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: LookupEmployeeByIdRequestKey, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): LookupEmployeeByIdRequestKey;
    static deserializeBinaryFromReader(message: LookupEmployeeByIdRequestKey, reader: jspb.BinaryReader): LookupEmployeeByIdRequestKey;
}

export namespace LookupEmployeeByIdRequestKey {
    export type AsObject = {
        id: string,
    }
}

export class LookupEmployeeByIdRequest extends jspb.Message { 
    clearKeysList(): void;
    getKeysList(): Array<LookupEmployeeByIdRequestKey>;
    setKeysList(value: Array<LookupEmployeeByIdRequestKey>): LookupEmployeeByIdRequest;
    addKeys(value?: LookupEmployeeByIdRequestKey, index?: number): LookupEmployeeByIdRequestKey;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): LookupEmployeeByIdRequest.AsObject;
    static toObject(includeInstance: boolean, msg: LookupEmployeeByIdRequest): LookupEmployeeByIdRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: LookupEmployeeByIdRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): LookupEmployeeByIdRequest;
    static deserializeBinaryFromReader(message: LookupEmployeeByIdRequest, reader: jspb.BinaryReader): LookupEmployeeByIdRequest;
}

export namespace LookupEmployeeByIdRequest {
    export type AsObject = {
        keysList: Array<LookupEmployeeByIdRequestKey.AsObject>,
    }
}

export class LookupEmployeeByIdResponse extends jspb.Message { 
    clearResultList(): void;
    getResultList(): Array<Employee>;
    setResultList(value: Array<Employee>): LookupEmployeeByIdResponse;
    addResult(value?: Employee, index?: number): Employee;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): LookupEmployeeByIdResponse.AsObject;
    static toObject(includeInstance: boolean, msg: LookupEmployeeByIdResponse): LookupEmployeeByIdResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: LookupEmployeeByIdResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): LookupEmployeeByIdResponse;
    static deserializeBinaryFromReader(message: LookupEmployeeByIdResponse, reader: jspb.BinaryReader): LookupEmployeeByIdResponse;
}

export namespace LookupEmployeeByIdResponse {
    export type AsObject = {
        resultList: Array<Employee.AsObject>,
    }
}

export class QueryCoursesRequest extends jspb.Message { 

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryCoursesRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryCoursesRequest): QueryCoursesRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryCoursesRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryCoursesRequest;
    static deserializeBinaryFromReader(message: QueryCoursesRequest, reader: jspb.BinaryReader): QueryCoursesRequest;
}

export namespace QueryCoursesRequest {
    export type AsObject = {
    }
}

export class QueryCoursesResponse extends jspb.Message { 
    clearCoursesList(): void;
    getCoursesList(): Array<Course>;
    setCoursesList(value: Array<Course>): QueryCoursesResponse;
    addCourses(value?: Course, index?: number): Course;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryCoursesResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryCoursesResponse): QueryCoursesResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryCoursesResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryCoursesResponse;
    static deserializeBinaryFromReader(message: QueryCoursesResponse, reader: jspb.BinaryReader): QueryCoursesResponse;
}

export namespace QueryCoursesResponse {
    export type AsObject = {
        coursesList: Array<Course.AsObject>,
    }
}

export class QueryCourseRequest extends jspb.Message { 
    getId(): string;
    setId(value: string): QueryCourseRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryCourseRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryCourseRequest): QueryCourseRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryCourseRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryCourseRequest;
    static deserializeBinaryFromReader(message: QueryCourseRequest, reader: jspb.BinaryReader): QueryCourseRequest;
}

export namespace QueryCourseRequest {
    export type AsObject = {
        id: string,
    }
}

export class QueryCourseResponse extends jspb.Message { 

    hasCourse(): boolean;
    clearCourse(): void;
    getCourse(): Course | undefined;
    setCourse(value?: Course): QueryCourseResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryCourseResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryCourseResponse): QueryCourseResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryCourseResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryCourseResponse;
    static deserializeBinaryFromReader(message: QueryCourseResponse, reader: jspb.BinaryReader): QueryCourseResponse;
}

export namespace QueryCourseResponse {
    export type AsObject = {
        course?: Course.AsObject,
    }
}

export class QueryLessonsRequest extends jspb.Message { 
    getCourseId(): string;
    setCourseId(value: string): QueryLessonsRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryLessonsRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryLessonsRequest): QueryLessonsRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryLessonsRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryLessonsRequest;
    static deserializeBinaryFromReader(message: QueryLessonsRequest, reader: jspb.BinaryReader): QueryLessonsRequest;
}

export namespace QueryLessonsRequest {
    export type AsObject = {
        courseId: string,
    }
}

export class QueryLessonsResponse extends jspb.Message { 
    clearLessonsList(): void;
    getLessonsList(): Array<Lesson>;
    setLessonsList(value: Array<Lesson>): QueryLessonsResponse;
    addLessons(value?: Lesson, index?: number): Lesson;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryLessonsResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryLessonsResponse): QueryLessonsResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryLessonsResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryLessonsResponse;
    static deserializeBinaryFromReader(message: QueryLessonsResponse, reader: jspb.BinaryReader): QueryLessonsResponse;
}

export namespace QueryLessonsResponse {
    export type AsObject = {
        lessonsList: Array<Lesson.AsObject>,
    }
}

export class QueryKillCoursesServiceRequest extends jspb.Message { 

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryKillCoursesServiceRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryKillCoursesServiceRequest): QueryKillCoursesServiceRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryKillCoursesServiceRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryKillCoursesServiceRequest;
    static deserializeBinaryFromReader(message: QueryKillCoursesServiceRequest, reader: jspb.BinaryReader): QueryKillCoursesServiceRequest;
}

export namespace QueryKillCoursesServiceRequest {
    export type AsObject = {
    }
}

export class QueryKillCoursesServiceResponse extends jspb.Message { 
    getKillCoursesService(): boolean;
    setKillCoursesService(value: boolean): QueryKillCoursesServiceResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryKillCoursesServiceResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryKillCoursesServiceResponse): QueryKillCoursesServiceResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryKillCoursesServiceResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryKillCoursesServiceResponse;
    static deserializeBinaryFromReader(message: QueryKillCoursesServiceResponse, reader: jspb.BinaryReader): QueryKillCoursesServiceResponse;
}

export namespace QueryKillCoursesServiceResponse {
    export type AsObject = {
        killCoursesService: boolean,
    }
}

export class QueryThrowErrorCoursesRequest extends jspb.Message { 

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryThrowErrorCoursesRequest.AsObject;
    static toObject(includeInstance: boolean, msg: QueryThrowErrorCoursesRequest): QueryThrowErrorCoursesRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryThrowErrorCoursesRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryThrowErrorCoursesRequest;
    static deserializeBinaryFromReader(message: QueryThrowErrorCoursesRequest, reader: jspb.BinaryReader): QueryThrowErrorCoursesRequest;
}

export namespace QueryThrowErrorCoursesRequest {
    export type AsObject = {
    }
}

export class QueryThrowErrorCoursesResponse extends jspb.Message { 
    getThrowErrorCourses(): boolean;
    setThrowErrorCourses(value: boolean): QueryThrowErrorCoursesResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryThrowErrorCoursesResponse.AsObject;
    static toObject(includeInstance: boolean, msg: QueryThrowErrorCoursesResponse): QueryThrowErrorCoursesResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: QueryThrowErrorCoursesResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): QueryThrowErrorCoursesResponse;
    static deserializeBinaryFromReader(message: QueryThrowErrorCoursesResponse, reader: jspb.BinaryReader): QueryThrowErrorCoursesResponse;
}

export namespace QueryThrowErrorCoursesResponse {
    export type AsObject = {
        throwErrorCourses: boolean,
    }
}

export class MutationAddCourseRequest extends jspb.Message { 
    getTitle(): string;
    setTitle(value: string): MutationAddCourseRequest;
    getInstructorId(): number;
    setInstructorId(value: number): MutationAddCourseRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): MutationAddCourseRequest.AsObject;
    static toObject(includeInstance: boolean, msg: MutationAddCourseRequest): MutationAddCourseRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: MutationAddCourseRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): MutationAddCourseRequest;
    static deserializeBinaryFromReader(message: MutationAddCourseRequest, reader: jspb.BinaryReader): MutationAddCourseRequest;
}

export namespace MutationAddCourseRequest {
    export type AsObject = {
        title: string,
        instructorId: number,
    }
}

export class MutationAddCourseResponse extends jspb.Message { 

    hasAddCourse(): boolean;
    clearAddCourse(): void;
    getAddCourse(): Course | undefined;
    setAddCourse(value?: Course): MutationAddCourseResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): MutationAddCourseResponse.AsObject;
    static toObject(includeInstance: boolean, msg: MutationAddCourseResponse): MutationAddCourseResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: MutationAddCourseResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): MutationAddCourseResponse;
    static deserializeBinaryFromReader(message: MutationAddCourseResponse, reader: jspb.BinaryReader): MutationAddCourseResponse;
}

export namespace MutationAddCourseResponse {
    export type AsObject = {
        addCourse?: Course.AsObject,
    }
}

export class MutationAddLessonRequest extends jspb.Message { 
    getCourseId(): string;
    setCourseId(value: string): MutationAddLessonRequest;
    getTitle(): string;
    setTitle(value: string): MutationAddLessonRequest;
    getOrder(): number;
    setOrder(value: number): MutationAddLessonRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): MutationAddLessonRequest.AsObject;
    static toObject(includeInstance: boolean, msg: MutationAddLessonRequest): MutationAddLessonRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: MutationAddLessonRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): MutationAddLessonRequest;
    static deserializeBinaryFromReader(message: MutationAddLessonRequest, reader: jspb.BinaryReader): MutationAddLessonRequest;
}

export namespace MutationAddLessonRequest {
    export type AsObject = {
        courseId: string,
        title: string,
        order: number,
    }
}

export class MutationAddLessonResponse extends jspb.Message { 

    hasAddLesson(): boolean;
    clearAddLesson(): void;
    getAddLesson(): Lesson | undefined;
    setAddLesson(value?: Lesson): MutationAddLessonResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): MutationAddLessonResponse.AsObject;
    static toObject(includeInstance: boolean, msg: MutationAddLessonResponse): MutationAddLessonResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: MutationAddLessonResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): MutationAddLessonResponse;
    static deserializeBinaryFromReader(message: MutationAddLessonResponse, reader: jspb.BinaryReader): MutationAddLessonResponse;
}

export namespace MutationAddLessonResponse {
    export type AsObject = {
        addLesson?: Lesson.AsObject,
    }
}

export class Employee extends jspb.Message { 
    getId(): number;
    setId(value: number): Employee;
    clearTaughtCoursesList(): void;
    getTaughtCoursesList(): Array<Course>;
    setTaughtCoursesList(value: Array<Course>): Employee;
    addTaughtCourses(value?: Course, index?: number): Course;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Employee.AsObject;
    static toObject(includeInstance: boolean, msg: Employee): Employee.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Employee, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Employee;
    static deserializeBinaryFromReader(message: Employee, reader: jspb.BinaryReader): Employee;
}

export namespace Employee {
    export type AsObject = {
        id: number,
        taughtCoursesList: Array<Course.AsObject>,
    }
}

export class Course extends jspb.Message { 
    getId(): string;
    setId(value: string): Course;
    getTitle(): string;
    setTitle(value: string): Course;

    hasDescription(): boolean;
    clearDescription(): void;
    getDescription(): google_protobuf_wrappers_pb.StringValue | undefined;
    setDescription(value?: google_protobuf_wrappers_pb.StringValue): Course;

    hasInstructor(): boolean;
    clearInstructor(): void;
    getInstructor(): Employee | undefined;
    setInstructor(value?: Employee): Course;
    clearLessonsList(): void;
    getLessonsList(): Array<Lesson>;
    setLessonsList(value: Array<Lesson>): Course;
    addLessons(value?: Lesson, index?: number): Lesson;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Course.AsObject;
    static toObject(includeInstance: boolean, msg: Course): Course.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Course, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Course;
    static deserializeBinaryFromReader(message: Course, reader: jspb.BinaryReader): Course;
}

export namespace Course {
    export type AsObject = {
        id: string,
        title: string,
        description?: google_protobuf_wrappers_pb.StringValue.AsObject,
        instructor?: Employee.AsObject,
        lessonsList: Array<Lesson.AsObject>,
    }
}

export class Lesson extends jspb.Message { 
    getId(): string;
    setId(value: string): Lesson;
    getCourseId(): string;
    setCourseId(value: string): Lesson;
    getTitle(): string;
    setTitle(value: string): Lesson;

    hasDescription(): boolean;
    clearDescription(): void;
    getDescription(): google_protobuf_wrappers_pb.StringValue | undefined;
    setDescription(value?: google_protobuf_wrappers_pb.StringValue): Lesson;
    getOrder(): number;
    setOrder(value: number): Lesson;

    hasCourse(): boolean;
    clearCourse(): void;
    getCourse(): Course | undefined;
    setCourse(value?: Course): Lesson;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Lesson.AsObject;
    static toObject(includeInstance: boolean, msg: Lesson): Lesson.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Lesson, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Lesson;
    static deserializeBinaryFromReader(message: Lesson, reader: jspb.BinaryReader): Lesson;
}

export namespace Lesson {
    export type AsObject = {
        id: string,
        courseId: string,
        title: string,
        description?: google_protobuf_wrappers_pb.StringValue.AsObject,
        order: number,
        course?: Course.AsObject,
    }
}
