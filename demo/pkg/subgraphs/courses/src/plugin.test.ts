import { describe, it, expect, vi } from 'vitest';
import type * as grpc from '@grpc/grpc-js';
import {
  QueryCoursesRequest,
  QueryCoursesResponse,
  QueryCourseRequest,
  QueryCourseResponse,
  QueryLessonsRequest,
  QueryLessonsResponse,
  QueryKillCoursesServiceRequest,
  QueryKillCoursesServiceResponse,
  QueryThrowErrorCoursesRequest,
  QueryThrowErrorCoursesResponse,
  MutationAddCourseRequest,
  MutationAddCourseResponse,
  MutationAddLessonRequest,
  MutationAddLessonResponse,
  LookupEmployeeByIdRequest,
  LookupEmployeeByIdRequestKey,
  LookupEmployeeByIdResponse,
} from '../generated/service_pb.js';
import plugin from './plugin.js';

// Helper to create mock gRPC call
function createMockCall<T>(request: T): grpc.ServerUnaryCall<T, any> {
  return {
    request,
  } as grpc.ServerUnaryCall<T, any>;
}

// Helper to create mock callback
function createMockCallback<T>(): { callback: grpc.sendUnaryData<T>; promise: Promise<T> } {
  let resolvePromise: (value: T) => void;
  let rejectPromise: (error: any) => void;
  
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const callback = ((error: any, response: T) => {
    if (error) {
      rejectPromise(error);
    } else {
      resolvePromise(response);
    }
  }) as grpc.sendUnaryData<T>;

  return { callback, promise };
}

describe('Courses Plugin', () => {
  describe('Queries', () => {
    it('should return all courses', async () => {
      const request = new QueryCoursesRequest();
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<QueryCoursesResponse>();

      plugin.queryCourses(call, callback);

      const response = await promise;
      const courses = response.getCoursesList();
      
      expect(courses.length).toBe(3);
      expect(courses[0].getId()).toBe('1');
      expect(courses[0].getTitle()).toBe('Introduction to TypeScript');
      expect(courses[1].getId()).toBe('2');
      expect(courses[1].getTitle()).toBe('Advanced GraphQL');
      expect(courses[2].getId()).toBe('3');
      expect(courses[2].getTitle()).toBe('Go Programming');
    });

    it('should return a single course by ID', async () => {
      const request = new QueryCourseRequest();
      request.setId('1');
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<QueryCourseResponse>();

      plugin.queryCourse(call, callback);

      const response = await promise;
      const course = response.getCourse();
      
      expect(course).toBeDefined();
      expect(course!.getId()).toBe('1');
      expect(course!.getTitle()).toBe('Introduction to TypeScript');
      expect(course!.getDescription()?.getValue()).toBe('Learn the basics of TypeScript');
      expect(course!.getInstructor()?.getId()).toBe(1);
      expect(course!.getLessonsList().length).toBe(3);
    });

    it('should return lessons for a course', async () => {
      const request = new QueryLessonsRequest();
      request.setCourseId('1');
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<QueryLessonsResponse>();

      plugin.queryLessons(call, callback);

      const response = await promise;
      const lessons = response.getLessonsList();
      
      expect(lessons.length).toBe(3);
      expect(lessons[0].getId()).toBe('1');
      expect(lessons[0].getCourseId()).toBe('1');
      expect(lessons[0].getTitle()).toBe('TypeScript Basics');
      expect(lessons[0].getOrder()).toBe(1);
      expect(lessons[1].getTitle()).toBe('Interfaces and Types');
      expect(lessons[2].getTitle()).toBe('Generics');
    });

    it('should return true for killCoursesService', async () => {
      const request = new QueryKillCoursesServiceRequest();
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<QueryKillCoursesServiceResponse>();

      // Mock process.exit to prevent actual exit
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      plugin.queryKillCoursesService(call, callback);

      const response = await promise;
      expect(response.getKillCoursesService()).toBe(true);
      
      // Cleanup
      exitSpy.mockRestore();
    });

    it('should throw error for throwErrorCourses', async () => {
      const request = new QueryThrowErrorCoursesRequest();
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<QueryThrowErrorCoursesResponse>();

      expect(() => {
        plugin.queryThrowErrorCourses(call, callback);
      }).toThrow('Courses service encountered a critical error!');
    });
  });

  describe('Mutations', () => {
    it('should create a new course', async () => {
      const request = new MutationAddCourseRequest();
      request.setTitle('New Test Course');
      request.setInstructorId(1);
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<MutationAddCourseResponse>();

      plugin.mutationAddCourse(call, callback);

      const response = await promise;
      const course = response.getAddCourse();
      
      expect(course).toBeDefined();
      expect(course!.getTitle()).toBe('New Test Course');
      expect(course!.getId()).toBe('1001'); // First generated ID after sample data
      expect(course!.getInstructor()!.getId()).toBe(1);
      expect(course!.getLessonsList().length).toBe(0); // New course has no lessons yet
    });

    it('should create a new lesson', async () => {
      const request = new MutationAddLessonRequest();
      request.setCourseId('1');
      request.setTitle('New Test Lesson');
      request.setOrder(10);
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<MutationAddLessonResponse>();

      plugin.mutationAddLesson(call, callback);

      const response = await promise;
      const lesson = response.getAddLesson();
      
      expect(lesson).toBeDefined();
      expect(lesson!.getTitle()).toBe('New Test Lesson');
      expect(lesson!.getCourseId()).toBe('1');
      expect(lesson!.getOrder()).toBe(10);
      expect(lesson!.getCourse()!.getId()).toBe('1');
    });
  });

  describe('Lookups', () => {
    it('should lookup employees by ID and return taught courses', async () => {
      const request = new LookupEmployeeByIdRequest();
      const key1 = new LookupEmployeeByIdRequestKey();
      key1.setId('1');
      request.setKeysList([key1]);
      
      const call = createMockCall(request);
      const { callback, promise } = createMockCallback<LookupEmployeeByIdResponse>();

      plugin.lookupEmployeeById(call, callback);

      const response = await promise;
      const employees = response.getResultList();
      
      expect(employees.length).toBe(1);
      expect(employees[0].getId()).toBe(1);
      const taughtCourses = employees[0].getTaughtCoursesList();
      expect(taughtCourses.length).toBe(2);
      expect(taughtCourses[0].getId()).toBe('1');
      expect(taughtCourses[0].getTitle()).toBe('Introduction to TypeScript');
      expect(taughtCourses[1].getId()).toBe('2');
      expect(taughtCourses[1].getTitle()).toBe('Advanced GraphQL');
    });
  });
});
