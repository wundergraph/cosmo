import Divider from "../_components/divider";

export default function AuthSkeleton() {
  return (
    <div className="mt-12 w-full space-y-4">
      <div className="animate-pulse space-y-4">
        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6" />
        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6"/>
        <Divider />
        <div className="text-md h-14 rounded-md border border-gray-700/50 bg-gray-800/50 px-12 py-6"/>
      </div>
    </div>
  );
}
