import com.apollographql.apollo3.ApolloClient
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.withIndex
import kotlinx.coroutines.runBlocking
import org.example.graphql.QueryFailureQuery
import org.example.graphql.QuerySuccessQuery
import org.example.graphql.SubscriptionSuccessSubscription
import org.junit.jupiter.api.Assertions.*
import kotlin.test.Test
import kotlin.test.expect

class BatchingTest {

    private val serverUrl = "http://localhost:3002/graphql"

    @Test
    fun testQueryBatchingWhereBothAreSuccess()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .httpBatching(
                batchIntervalMillis = 50,
                maxBatchSize = 20
            )
            .build()

        runBlocking {
            val response1Deferred = async { apolloClient.query(QuerySuccessQuery()).execute() }
            val response2Deferred = async { apolloClient.query(QuerySuccessQuery()).execute() }

            val response1 = response1Deferred.await()
            val response2 = response2Deferred.await()

            val expected =
                "Data(employees=[Employee(id=1, isAvailable=false), Employee(id=2, isAvailable=false), Employee(id=3, isAvailable=false), Employee(id=4, isAvailable=false), Employee(id=5, isAvailable=false), Employee(id=7, isAvailable=false), Employee(id=8, isAvailable=false), Employee(id=10, isAvailable=false), Employee(id=11, isAvailable=false), Employee(id=12, isAvailable=false)])"
            assertEquals(expected, response1.data.toString())
            assertEquals(expected, response2.data.toString())
        }
    }

    @Test
    fun testQueryBatchingWhereBothAreFailure()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .httpBatching(
                batchIntervalMillis = 50,
                maxBatchSize = 20
            )
            .build()

        runBlocking {
            val response1Deferred = async { apolloClient.query(QueryFailureQuery()).execute() }
            val response2Deferred = async { apolloClient.query(QueryFailureQuery()).execute() }

            val response1 = response1Deferred.await()
            val response2 = response2Deferred.await()

            assertNull(response1.data)
            assertNull(response2.data)

            val expected =
                "[Error(message = field: isAvailable2 not defined on type: Employee, locations = null, path=[query, employees], extensions = null, nonStandardFields = null)]"
            assertEquals(expected, response1.errors.toString())
            assertEquals(expected, response2.errors.toString())
        }
    }

    @Test
    fun testQueryBatchingWhereMixed()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .httpBatching(
                batchIntervalMillis = 50,
                maxBatchSize = 20
            )
            .build()

        runBlocking {
            val response1Deferred = async { apolloClient.query(QueryFailureQuery()).execute() }
            val response2Deferred = async { apolloClient.query(QuerySuccessQuery()).execute() }
            val response3Deferred = async { apolloClient.query(QuerySuccessQuery()).execute() }
            val response4Deferred = async { apolloClient.query(QueryFailureQuery()).execute() }
            val response5Deferred = async { apolloClient.query(QueryFailureQuery()).execute() }

            val response1 = response1Deferred.await()
            val response2 = response2Deferred.await()
            val response3 = response3Deferred.await()
            val response4 = response4Deferred.await()
            val response5 = response5Deferred.await()

            assertNull(response1.data)
            assertNull(response4.data)
            assertNull(response5.data)

            assertNull(response2.errors)
            assertNull(response3.errors)

            val expectedError =
                "[Error(message = field: isAvailable2 not defined on type: Employee, locations = null, path=[query, employees], extensions = null, nonStandardFields = null)]"

            val expectedSuccess =
                "Data(employees=[Employee(id=1, isAvailable=false), Employee(id=2, isAvailable=false), Employee(id=3, isAvailable=false), Employee(id=4, isAvailable=false), Employee(id=5, isAvailable=false), Employee(id=7, isAvailable=false), Employee(id=8, isAvailable=false), Employee(id=10, isAvailable=false), Employee(id=11, isAvailable=false), Employee(id=12, isAvailable=false)])"

            assertEquals(expectedError, response1.errors.toString())
            assertEquals(expectedError, response4.errors.toString())
            assertEquals(expectedError, response5.errors.toString())

            assertEquals(expectedSuccess, response2.data.toString())
            assertEquals(expectedSuccess, response3.data.toString())
        }
    }

    @Test
    fun testQueryBatchingLargeCount()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .httpBatching(
                batchIntervalMillis = 500,
                maxBatchSize = 2000
            )
            .build()

        runBlocking {
            val totalQueries = 1700
            val deferredResponses = (1..totalQueries).map {
                async { apolloClient.query(QuerySuccessQuery()).execute() }
            }

            val responses = deferredResponses.map { it.await() }

            val expected =
                "Data(employees=[Employee(id=1, isAvailable=false), Employee(id=2, isAvailable=false), Employee(id=3, isAvailable=false), Employee(id=4, isAvailable=false), Employee(id=5, isAvailable=false), Employee(id=7, isAvailable=false), Employee(id=8, isAvailable=false), Employee(id=10, isAvailable=false), Employee(id=11, isAvailable=false), Employee(id=12, isAvailable=false)])"

            responses.forEach { response ->
                assertNull(response.errors)
                assertEquals(expected, response.data.toString())
            }
        }
    }

}