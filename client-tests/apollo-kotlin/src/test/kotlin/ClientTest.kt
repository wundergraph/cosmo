import com.apollographql.apollo3.ApolloClient
import kotlinx.coroutines.flow.withIndex
import kotlinx.coroutines.runBlocking
import org.example.graphql.QueryFailureQuery
import org.example.graphql.QuerySuccessQuery
import org.example.graphql.SubscriptionSuccessSubscription
import org.junit.jupiter.api.Assertions.*
import kotlin.test.Test
import kotlin.test.expect

class ClientTest {

    private val serverUrl = "http://localhost:3002/graphql"

    @Test
    fun testFailingQuery()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .build()

        runBlocking {
            val response = apolloClient.query(QueryFailureQuery()).execute()
            val expected =
                "[Error(message = field: isAvailable2 not defined on type: Employee, locations = null, path=[query, employees], extensions = null, nonStandardFields = null)]"
            assertEquals(expected, response.errors.toString())
            assertNull(response.data)
        }
    }

    @Test
    fun testSuccessQuery()  {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .build()

        runBlocking {
            val response = apolloClient.query(QuerySuccessQuery()).execute()
            assertNull(response.errors)
            val expected =
                "Data(employees=[Employee(id=1, isAvailable=false), Employee(id=2, isAvailable=false), Employee(id=3, isAvailable=false), Employee(id=4, isAvailable=false), Employee(id=5, isAvailable=false), Employee(id=7, isAvailable=false), Employee(id=8, isAvailable=false), Employee(id=10, isAvailable=false), Employee(id=11, isAvailable=false), Employee(id=12, isAvailable=false)])"
            assertEquals(expected, response.data.toString())
        }
    }

    @Test
    fun testSuccessSubscription() {
        val apolloClient = ApolloClient.Builder()
            .serverUrl(serverUrl)
            .build()

        runBlocking {
            apolloClient.subscription(SubscriptionSuccessSubscription())
                .toFlow()
                .withIndex()
                .collect { (index, item) ->
                    assertEquals(index, item.data?.countEmp2)
                    assertNull(item.errors)
                }
        }
    }
}