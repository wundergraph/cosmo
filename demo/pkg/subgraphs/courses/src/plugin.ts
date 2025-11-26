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
  LookupEmployeeByIdResponse,
  Course,
  Lesson,
  Employee,
} from '../generated/service_pb.js';

import { StringValue } from 'google-protobuf/google/protobuf/wrappers_pb.js';
import { CoursesServiceService } from '../generated/service_grpc_pb.js';
import { PluginServer } from './plugin-server.js';

// Thread-safe counter for generating unique IDs using atomics
const counterBuffer = new SharedArrayBuffer(4);
const counterArray = new Int32Array(counterBuffer);
Atomics.store(counterArray, 0, 1000); // Initialize counter to 1000

function generateId(): string {
  return String(Atomics.add(counterArray, 0, 1));
}

// Simple data structures
interface CourseData {
  id: string;
  title: string;
  description?: string;
  instructorId: number;
  lessonIds: string[];
}

interface LessonData {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  order: number;
}

interface EmployeeData {
  id: number;
  taughtCourseIds: string[];
}

// In-memory data stores
const courses = new Map<string, CourseData>();
const lessons = new Map<string, LessonData>();
const employees = new Map<number, EmployeeData>();

// Initialize sample data
function initializeSampleData() {
  // Add sample employees
  employees.set(1, { id: 1, taughtCourseIds: ['1', '2'] });
  employees.set(2, { id: 2, taughtCourseIds: ['3'] });
  employees.set(3, { id: 3, taughtCourseIds: [] });

  // Add sample courses
  courses.set('1', {
    id: '1',
    title: 'Introduction to TypeScript',
    description: 'Learn the basics of TypeScript',
    instructorId: 1,
    lessonIds: ['1', '2', '3'],
  });

  courses.set('2', {
    id: '2',
    title: 'Advanced GraphQL',
    description: 'Master GraphQL federation',
    instructorId: 1,
    lessonIds: ['4', '5'],
  });

  courses.set('3', {
    id: '3',
    title: 'Go Programming',
    description: 'Build services with Go',
    instructorId: 2,
    lessonIds: ['6'],
  });

  // Add sample lessons
  lessons.set('1', {
    id: '1',
    courseId: '1',
    title: 'TypeScript Basics',
    description: 'Introduction to types',
    order: 1,
  });

  lessons.set('2', {
    id: '2',
    courseId: '1',
    title: 'Interfaces and Types',
    description: 'Advanced type systems',
    order: 2,
  });

  lessons.set('3', {
    id: '3',
    courseId: '1',
    title: 'Generics',
    description: 'Working with generic types',
    order: 3,
  });

  lessons.set('4', {
    id: '4',
    courseId: '2',
    title: 'Federation Basics',
    description: 'Understanding federated schemas',
    order: 1,
  });

  lessons.set('5', {
    id: '5',
    courseId: '2',
    title: 'Subgraph Design',
    description: 'Designing effective subgraphs',
    order: 2,
  });

  lessons.set('6', {
    id: '6',
    courseId: '3',
    title: 'Go Concurrency',
    description: 'Goroutines and channels',
    order: 1,
  });
}

// Initialize data on module load
initializeSampleData();

// Helper functions to convert data to protobuf messages
function courseDataToCourse(data: CourseData): Course {
  const course = new Course();
  course.setId(data.id);
  course.setTitle(data.title);
  if (data.description) {
    course.setDescription(new StringValue().setValue(data.description));
  }

  // Set instructor reference (stub for federation)
  const instructor = new Employee();
  instructor.setId(data.instructorId);
  course.setInstructor(instructor);

  // Set lessons
  const courseLessons: Lesson[] = [];
  for (const lessonId of data.lessonIds) {
    const lessonData = lessons.get(lessonId);
    if (lessonData) {
      courseLessons.push(lessonDataToLesson(lessonData));
    }
  }
  course.setLessonsList(courseLessons);

  return course;
}

function lessonDataToLesson(data: LessonData): Lesson {
  const lesson = new Lesson();
  lesson.setId(data.id);
  lesson.setCourseId(data.courseId);
  lesson.setTitle(data.title);
  if (data.description) {
    lesson.setDescription(new StringValue().setValue(data.description));
  }
  lesson.setOrder(data.order);

  // Set course reference (stub for federation)
  const course = new Course();
  course.setId(data.courseId);
  lesson.setCourse(course);

  return lesson;
}

function employeeDataToEmployee(data: EmployeeData): Employee {
  const employee = new Employee();
  employee.setId(data.id);

  // Set taught courses
  const taughtCourses: Course[] = [];
  for (const courseId of data.taughtCourseIds) {
    const courseData = courses.get(courseId);
    if (courseData) {
      taughtCourses.push(courseDataToCourse(courseData));
    }
  }
  employee.setTaughtCoursesList(taughtCourses);

  return employee;
}

// Plugin implementation
const pluginImplementation = {
  // Query: courses
  queryCourses: (
    call: grpc.ServerUnaryCall<QueryCoursesRequest, QueryCoursesResponse>,
    callback: grpc.sendUnaryData<QueryCoursesResponse>
  ) => {
    const response = new QueryCoursesResponse();
    const allCourses = Array.from(courses.values()).map(courseDataToCourse);
    response.setCoursesList(allCourses);
    callback(null, response);
  },

  // Query: course
  queryCourse: (
    call: grpc.ServerUnaryCall<QueryCourseRequest, QueryCourseResponse>,
    callback: grpc.sendUnaryData<QueryCourseResponse>
  ) => {
    const id = call.request.getId();
    const response = new QueryCourseResponse();
    
    const courseData = courses.get(id);
    if (courseData) {
      response.setCourse(courseDataToCourse(courseData));
    }
    
    callback(null, response);
  },

  // Query: lessons
  queryLessons: (
    call: grpc.ServerUnaryCall<QueryLessonsRequest, QueryLessonsResponse>,
    callback: grpc.sendUnaryData<QueryLessonsResponse>
  ) => {
    const courseId = call.request.getCourseId();
    const response = new QueryLessonsResponse();
    
    const courseLessons = Array.from(lessons.values())
      .filter(l => l.courseId === courseId)
      .map(lessonDataToLesson);
    
    response.setLessonsList(courseLessons);
    callback(null, response);
  },

  // Query: killCoursesService
  queryKillCoursesService: (
    call: grpc.ServerUnaryCall<QueryKillCoursesServiceRequest, QueryKillCoursesServiceResponse>,
    callback: grpc.sendUnaryData<QueryKillCoursesServiceResponse>
  ) => {
    const response = new QueryKillCoursesServiceResponse();
    response.setKillCoursesService(true);
    callback(null, response);
    
    // Shut down the service after responding
    setTimeout(() => {
      process.exit(0);
    }, 100);
  },

  // Query: throwErrorCourses
  queryThrowErrorCourses: (
    call: grpc.ServerUnaryCall<QueryThrowErrorCoursesRequest, QueryThrowErrorCoursesResponse>,
    callback: grpc.sendUnaryData<QueryThrowErrorCoursesResponse>
  ) => {
    // Throw an error as requested
    throw new Error('Courses service encountered a critical error!');
  },

  // Mutation: addCourse
  mutationAddCourse: (
    call: grpc.ServerUnaryCall<MutationAddCourseRequest, MutationAddCourseResponse>,
    callback: grpc.sendUnaryData<MutationAddCourseResponse>
  ) => {
    const title = call.request.getTitle();
    const instructorId = call.request.getInstructorId();
    
    const newCourse: CourseData = {
      id: generateId(),
      title,
      instructorId,
      lessonIds: [],
    };
    
    courses.set(newCourse.id, newCourse);
    
    // Add to employee's taught courses
    const employee = employees.get(instructorId);
    if (employee) {
      employee.taughtCourseIds.push(newCourse.id);
    } else {
      employees.set(instructorId, { id: instructorId, taughtCourseIds: [newCourse.id] });
    }
    
    const response = new MutationAddCourseResponse();
    response.setAddCourse(courseDataToCourse(newCourse));
    callback(null, response);
  },

  // Mutation: addLesson
  mutationAddLesson: (
    call: grpc.ServerUnaryCall<MutationAddLessonRequest, MutationAddLessonResponse>,
    callback: grpc.sendUnaryData<MutationAddLessonResponse>
  ) => {
    const courseId = call.request.getCourseId();
    const title = call.request.getTitle();
    const order = call.request.getOrder();
    
    const newLesson: LessonData = {
      id: generateId(),
      courseId,
      title,
      order,
    };
    
    lessons.set(newLesson.id, newLesson);
    
    // Add to course's lesson list
    const course = courses.get(courseId);
    if (course) {
      course.lessonIds.push(newLesson.id);
    }
    
    const response = new MutationAddLessonResponse();
    response.setAddLesson(lessonDataToLesson(newLesson));
    callback(null, response);
  },

  // Federation: Lookup Employee by ID
  lookupEmployeeById: (
    call: grpc.ServerUnaryCall<LookupEmployeeByIdRequest, LookupEmployeeByIdResponse>,
    callback: grpc.sendUnaryData<LookupEmployeeByIdResponse>
  ) => {
    const response = new LookupEmployeeByIdResponse();
    const results: Employee[] = [];
    
    for (const key of call.request.getKeysList()) {
      const idStr = key.getId();
      const id = parseInt(idStr, 10);
      let employeeData = employees.get(id);
      
      // Create employee if doesn't exist
      if (!employeeData) {
        employeeData = { id, taughtCourseIds: [] };
        employees.set(id, employeeData);
      }
      
      results.push(employeeDataToEmployee(employeeData));
    }
    
    response.setResultList(results);
    callback(null, response);
  },
};

// Export for testing
export default pluginImplementation;

// Start the plugin server
const server = new PluginServer();
server.addService(CoursesServiceService, pluginImplementation);
server.serve().catch((error) => {
  console.error('Failed to start plugin server:', error);
  process.exit(1);
});
