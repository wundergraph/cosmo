import Divider from "../_components/divider";

function AuthSkeleton() {
  return (
    <div className="mt-12 space-y-4 w-full">
      <div className="animate-pulse space-y-4">
        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6"></div>

        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6"></div>

        <Divider />
        
        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6"></div>
      </div>
    </div>
  );
}

export default AuthSkeleton; 
